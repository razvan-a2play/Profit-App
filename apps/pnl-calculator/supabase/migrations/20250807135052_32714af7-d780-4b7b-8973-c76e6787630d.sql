-- Create a policy to allow public read access to Product Information table
CREATE POLICY "Allow public read access to Product Information" 
ON public."Product Information" 
FOR SELECT 
USING (true);