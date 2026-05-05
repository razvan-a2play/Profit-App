-- Update the create_version_history_entry function to exclude marketing calculation fields
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
  -- List of calculated/derived fields to exclude from history tracking
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
    -- Track different types of updates with field changes
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
      -- Capture detailed data changes (excluding calculated fields)
      IF OLD.version_data::jsonb != NEW.version_data::jsonb THEN
        old_data := OLD.version_data::jsonb;
        new_data := NEW.version_data::jsonb;
        field_changes := '{}';
        
        -- Get all unique keys from both old and new data
        SELECT array_agg(DISTINCT k) INTO all_keys
        FROM (
          SELECT jsonb_object_keys(old_data) as k
          UNION ALL
          SELECT jsonb_object_keys(new_data) as k
        ) keys;
        
        -- Compare fields, excluding calculated ones
        FOREACH key IN ARRAY all_keys
        LOOP
          -- Skip calculated/derived fields
          IF NOT (key = ANY(excluded_fields)) THEN
            old_val := old_data->key;
            new_val := new_data->key;
            
            -- Only track changes where values actually differ
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
        
        -- Add bucket change if applicable
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
      
      -- Only create history entry if there are actual user changes
      -- Fix: Check if field_changes has any keys by comparing to empty object
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
      'Version "' || OLD.version_name || '" deleted from ' || UPPER(OLD.bucket::text) || ' bucket',
      COALESCE((auth.jwt() ->> 'email'), OLD.creator_email),
      auth.uid()
    );
    RETURN OLD;
  END IF;
  
  RETURN NULL;
END;
$function$;