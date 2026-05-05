-- Fix search path for security
ALTER FUNCTION public.create_version_history_entry() SET search_path TO '';

-- Create trigger to automatically track version changes
CREATE TRIGGER trigger_version_history
  AFTER INSERT OR UPDATE OR DELETE ON public.product_versions
  FOR EACH ROW EXECUTE FUNCTION public.create_version_history_entry();