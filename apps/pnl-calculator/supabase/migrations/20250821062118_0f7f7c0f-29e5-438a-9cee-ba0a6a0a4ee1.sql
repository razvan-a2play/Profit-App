-- Create version history table to track detailed changes
CREATE TABLE public.version_history (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  version_id uuid NOT NULL,
  product_id integer NOT NULL,
  action_type text NOT NULL CHECK (action_type IN ('created', 'updated', 'renamed', 'deleted')),
  change_description text,
  changed_fields jsonb,
  user_email text,
  user_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.version_history ENABLE ROW LEVEL SECURITY;

-- Create policy for allowlisted users to view history
CREATE POLICY "Allow allowlisted users to read version history" 
ON public.version_history 
FOR SELECT 
USING (is_allowlisted_user());

-- Create policy for allowlisted users to insert history records
CREATE POLICY "Allow allowlisted users to insert version history" 
ON public.version_history 
FOR INSERT 
WITH CHECK (is_allowlisted_user());

-- Create index for better performance
CREATE INDEX idx_version_history_product_id ON public.version_history(product_id);
CREATE INDEX idx_version_history_created_at ON public.version_history(created_at DESC);

-- Function to automatically create history entries
CREATE OR REPLACE FUNCTION public.create_version_history_entry()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.version_history (version_id, product_id, action_type, change_description, user_email, user_id)
    VALUES (
      NEW.id,
      NEW.product_id,
      'created',
      'Version "' || NEW.version_name || '" created',
      NEW.creator_email,
      NEW.user_id
    );
    RETURN NEW;
  END IF;
  
  IF TG_OP = 'UPDATE' THEN
    -- Track different types of updates
    IF OLD.version_name != NEW.version_name AND OLD.version_data::text = NEW.version_data::text THEN
      INSERT INTO public.version_history (version_id, product_id, action_type, change_description, user_email, user_id)
      VALUES (
        NEW.id,
        NEW.product_id,
        'renamed',
        'Version renamed from "' || OLD.version_name || '" to "' || NEW.version_name || '"',
        COALESCE((auth.jwt() ->> 'email'), NEW.creator_email),
        auth.uid()
      );
    ELSE
      INSERT INTO public.version_history (version_id, product_id, action_type, change_description, user_email, user_id)
      VALUES (
        NEW.id,
        NEW.product_id,
        'updated',
        'Version "' || NEW.version_name || '" data updated',
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
      'Version "' || OLD.version_name || '" deleted',
      COALESCE((auth.jwt() ->> 'email'), OLD.creator_email),
      auth.uid()
    );
    RETURN OLD;
  END IF;
  
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;