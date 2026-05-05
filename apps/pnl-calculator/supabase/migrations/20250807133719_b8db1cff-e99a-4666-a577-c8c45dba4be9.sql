-- Drop and recreate the product_versions table with integer product_id
DROP TABLE IF EXISTS public.product_versions;

-- Create the table with integer product_id
CREATE TABLE public.product_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id integer NOT NULL,
  version_name text NOT NULL,
  version_data jsonb NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Add indexes for better performance
CREATE INDEX idx_product_versions_product_id ON public.product_versions(product_id);
CREATE INDEX idx_product_versions_created_at ON public.product_versions(created_at);

-- Enable Row Level Security
ALTER TABLE public.product_versions ENABLE ROW LEVEL SECURITY;

-- Create policies for public access (since no auth is implemented yet)
CREATE POLICY "Allow all operations on product_versions" 
ON public.product_versions 
FOR ALL 
USING (true);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_product_versions_updated_at
  BEFORE UPDATE ON public.product_versions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();