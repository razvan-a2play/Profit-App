-- Fix the DELETE case to include all required fields
CREATE OR REPLACE FUNCTION public.create_version_history_entry()
RETURNS TRIGGER AS $$
DECLARE
  changes_json jsonb := '{}';
  field_changes jsonb := '{}';
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.version_history (version_id, product_id, action_type, change_description, user_email, user_id)
    VALUES (
      NEW.id,
      NEW.product_id,
      'created',
      'Version "' || NEW.version_name || '" created in ' || UPPER(NEW.bucket) || ' bucket',
      NEW.creator_email,
      NEW.user_id
    );
    RETURN NEW;
  END IF;
  
  IF TG_OP = 'UPDATE' THEN
    -- Track different types of updates with field changes
    IF OLD.version_name != NEW.version_name AND OLD.version_data::text = NEW.version_data::text THEN
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
      -- Capture data changes
      IF OLD.version_data != NEW.version_data THEN
        field_changes := jsonb_build_object(
          'version_data', jsonb_build_object(
            'changed', true,
            'summary', 'Product configuration updated'
          )
        );
        
        -- Add bucket change if applicable
        IF OLD.bucket != NEW.bucket THEN
          field_changes := field_changes || jsonb_build_object(
            'bucket', jsonb_build_object(
              'from', OLD.bucket,
              'to', NEW.bucket
            )
          );
        END IF;
      END IF;
      
      INSERT INTO public.version_history (version_id, product_id, action_type, change_description, changed_fields, user_email, user_id)
      VALUES (
        NEW.id,
        NEW.product_id,
        'updated',
        'Version "' || NEW.version_name || '" data updated' || 
        CASE WHEN OLD.bucket != NEW.bucket THEN ' and moved from ' || UPPER(OLD.bucket) || ' to ' || UPPER(NEW.bucket) || ' bucket' ELSE '' END,
        field_changes,
        COALESCE((auth.jwt() ->> 'email'), NEW.creator_email),
        auth.uid()
      );
    END IF;
    RETURN NEW;
  END IF;
  
  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.version_history (version_id, product_id, action_type, change_description, user_email, user_id)
    VALUES (
      OLD.id,
      OLD.product_id,
      'deleted',
      'Version "' || OLD.version_name || '" deleted from ' || UPPER(OLD.bucket) || ' bucket',
      COALESCE((auth.jwt() ->> 'email'), OLD.creator_email),
      auth.uid()
    );
    RETURN OLD;
  END IF;
  
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '';