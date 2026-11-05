-- Allow each workspace member to receive only broadcast alerts and alerts addressed to them.
-- Inserts and mutations remain service-role only through notification-center and provider workers.
DROP POLICY IF EXISTS "members can receive workspace notifications" ON public.workspace_notifications;

CREATE POLICY "members can receive workspace notifications"
ON public.workspace_notifications
FOR SELECT
TO authenticated
USING (
  (recipient_user_id IS NULL OR recipient_user_id = (SELECT auth.uid()))
  AND EXISTS (
    SELECT 1
    FROM public.tenant_members tm
    WHERE tm.tenant_id = workspace_notifications.tenant_id
      AND tm.user_id = (SELECT auth.uid())
  )
);

GRANT SELECT ON public.workspace_notifications TO authenticated;

ALTER PUBLICATION supabase_realtime ADD TABLE public.workspace_notifications;
