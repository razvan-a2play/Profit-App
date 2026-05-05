-- Enhanced function to track detailed field-by-field changes
CREATE OR REPLACE FUNCTION public.create_version_history_entry()
RETURNS TRIGGER AS $$
DECLARE
  field_changes jsonb := '{}';
  old_data jsonb;
  new_data jsonb;
  key text;
  old_val jsonb;
  new_val jsonb;
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
      -- Capture detailed data changes
      IF OLD.version_data::jsonb != NEW.version_data::jsonb THEN
        old_data := OLD.version_data::jsonb;
        new_data := NEW.version_data::jsonb;
        field_changes := '{}';
        
        -- Compare all fields in the version data
        FOR key IN SELECT jsonb_object_keys(old_data UNION SELECT jsonb_object_keys(new_data))
        LOOP
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
      
      INSERT INTO public.version_history (version_id, product_id, action_type, change_description, changed_fields, user_email, user_id)
      VALUES (
        NEW.id,
        NEW.product_id,
        'updated',
        'Version "' || NEW.version_name || '" updated with ' || 
        COALESCE(jsonb_array_length(jsonb_object_keys(field_changes)), 0)::text || ' field changes' ||
        CASE WHEN OLD.bucket != NEW.bucket THEN ' and moved from ' || UPPER(OLD.bucket::text) || ' to ' || UPPER(NEW.bucket::text) || ' bucket' ELSE '' END,
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
      'Version "' || OLD.version_name || '" deleted from ' || UPPER(OLD.bucket::text) || ' bucket',
      COALESCE((auth.jwt() ->> 'email'), OLD.creator_email),
      auth.uid()
    );
    RETURN OLD;
  END IF;
  
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '';