-- Add soft delete column to product_versions table
ALTER TABLE public.product_versions 
ADD COLUMN deleted_at timestamp with time zone DEFAULT NULL;

-- Add index for better query performance on deleted items
CREATE INDEX idx_product_versions_deleted_at ON public.product_versions(deleted_at);

-- Update the version history trigger to handle soft deletes properly
CREATE OR REPLACE FUNCTION public.create_version_history_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  field_changes jsonb := '{}';
  old_data jsonb;
  new_data jsonb;
  all_keys text[];
  key text;
  old_val jsonb;
  new_val jsonb;
  excluded_fields text[] := ARRAY[
    'shippingToAMZCalculated',
    'awdReceivingCalculated', 
    'awdStorageCalculated',
    'awdReceivingCostCalculated',
    'storageAWDCostCalculated',
    'cbmCost',
    'amazonFBAStorageFeeNonPeak',
    'amazonFBAStorageFeePeak',
    'amazonAWDStorageFee',
    'amazonFBAAVGFee',
    'totalCost',
    'profit',
    'profitMargin',
    'grossMargin',
    'netMargin',
    'totalFees',
    'calculatedProfit',
    'calculatedMargin',
    'marketingTacos',
    'marketingTacosPercentage',
    'marketingAffiliatePercentage',
    'marketingAffiliateDollar',
    'marketingAdsPercentage',
    'marketingAdsDollar'
  ];
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.version_history (version_id, product_id, action_type, change_description, user_email, user_id)
    VALUES (
      NEW.id,
      NEW.product_id,
      'created',
      'Version "' || NEW.version_name || '" created in ' || UPPER(NEW.bucket::text) || ' bucket',
      NEW.creator_email,
      NEW.user_id
    );
    RETURN NEW;
  END IF;
  
  IF TG_OP = 'UPDATE' THEN
    -- Check if this is a soft delete (deleted_at changed from NULL to a timestamp)
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      INSERT INTO public.version_history (version_id, product_id, action_type, change_description, user_email, user_id)
      VALUES (
        NEW.id,
        NEW.product_id,
        'deleted',
        'Version "' || NEW.version_name || '" moved to trash from ' || UPPER(NEW.bucket::text) || ' bucket',
        COALESCE((auth.jwt() ->> 'email'), NEW.creator_email),
        auth.uid()
      );
      RETURN NEW;
    END IF;
    
    -- Check if this is a restore (deleted_at changed from timestamp to NULL)
    IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
      INSERT INTO public.version_history (version_id, product_id, action_type, change_description, user_email, user_id)
      VALUES (
        NEW.id,
        NEW.product_id,
        'created',
        'Version "' || NEW.version_name || '" restored from trash to ' || UPPER(NEW.bucket::text) || ' bucket',
        COALESCE((auth.jwt() ->> 'email'), NEW.creator_email),
        auth.uid()
      );
      RETURN NEW;
    END IF;
    
    -- Track rename operations
    IF OLD.version_name != NEW.version_name AND OLD.version_data::jsonb = NEW.version_data::jsonb THEN
      field_changes := jsonb_build_object(
        'version_name', jsonb_build_object(
          'from', OLD.version_name,
          'to', NEW.version_name
        )
      );
      
      INSERT INTO public.version_history (version_id, product_id, action_type, change_description, changed_fields, user_email, user_id)
      VALUES (
        NEW.id,
        NEW.product_id,
        'renamed',
        'Version renamed from "' || OLD.version_name || '" to "' || NEW.version_name || '"',
        field_changes,
        COALESCE((auth.jwt() ->> 'email'), NEW.creator_email),
        auth.uid()
      );
    ELSE
      -- Capture detailed data changes
      IF OLD.version_data::jsonb != NEW.version_data::jsonb THEN
        old_data := OLD.version_data::jsonb;
        new_data := NEW.version_data::jsonb;
        field_changes := '{}';
        
        SELECT array_agg(DISTINCT k) INTO all_keys
        FROM (
          SELECT jsonb_object_keys(old_data) as k
          UNION ALL
          SELECT jsonb_object_keys(new_data) as k
        ) keys;
        
        FOREACH key IN ARRAY all_keys
        LOOP
          IF NOT (key = ANY(excluded_fields)) THEN
            old_val := old_data->key;
            new_val := new_data->key;
            
            IF old_val IS DISTINCT FROM new_val THEN
              field_changes := field_changes || jsonb_build_object(
                key, jsonb_build_object(
                  'from', old_val,
                  'to', new_val,
                  'type', CASE 
                    WHEN old_val IS NULL THEN 'added'
                    WHEN new_val IS NULL THEN 'removed'
                    ELSE 'modified'
                  END
                )
              );
            END IF;
          END IF;
        END LOOP;
        
        IF OLD.bucket != NEW.bucket THEN
          field_changes := field_changes || jsonb_build_object(
            '_bucket', jsonb_build_object(
              'from', OLD.bucket,
              'to', NEW.bucket,
              'type', 'modified'
            )
          );
        END IF;
      END IF;
      
      IF field_changes != '{}'::jsonb THEN
        INSERT INTO public.version_history (version_id, product_id, action_type, change_description, changed_fields, user_email, user_id)
        VALUES (
          NEW.id,
          NEW.product_id,
          'updated',
          'Version "' || NEW.version_name || '" updated with ' || 
          (SELECT count(*) FROM jsonb_object_keys(field_changes))::text || ' field changes' ||
          CASE WHEN OLD.bucket != NEW.bucket THEN ' and moved from ' || UPPER(OLD.bucket::text) || ' to ' || UPPER(NEW.bucket::text) || ' bucket' ELSE '' END,
          field_changes,
          COALESCE((auth.jwt() ->> 'email'), NEW.creator_email),
          auth.uid()
        );
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  
  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.version_history (version_id, product_id, action_type, change_description, user_email, user_id)
    VALUES (
      OLD.id,
      OLD.product_id,
      'deleted',
      'Version "' || OLD.version_name || '" permanently deleted from ' || UPPER(OLD.bucket::text) || ' bucket',
      COALESCE((auth.jwt() ->> 'email'), OLD.creator_email),
      auth.uid()
    );
    RETURN OLD;
  END IF;
  
  RETURN NULL;
END;
$function$;