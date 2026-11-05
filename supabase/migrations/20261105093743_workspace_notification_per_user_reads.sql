ALTER TABLE public.workspace_notifications
  ADD CONSTRAINT workspace_notifications_tenant_id_id_key UNIQUE (tenant_id, id);

CREATE TABLE public.workspace_notification_reads (
  tenant_id uuid NOT NULL,
  notification_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, user_id),
  FOREIGN KEY (tenant_id, notification_id)
    REFERENCES public.workspace_notifications(tenant_id, id)
    ON DELETE CASCADE
);

ALTER TABLE public.workspace_notification_reads ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_notification_reads TO authenticated;

CREATE POLICY "users can manage their own notification read markers"
ON public.workspace_notification_reads
FOR ALL
TO authenticated
USING (
  user_id = (SELECT auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = workspace_notification_reads.tenant_id
      AND tm.user_id = (SELECT auth.uid())
  )
  AND EXISTS (
    SELECT 1 FROM public.workspace_notifications n
    WHERE n.tenant_id = workspace_notification_reads.tenant_id
      AND n.id = workspace_notification_reads.notification_id
      AND (n.recipient_user_id IS NULL OR n.recipient_user_id = (SELECT auth.uid()))
  )
)
WITH CHECK (
  user_id = (SELECT auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = workspace_notification_reads.tenant_id
      AND tm.user_id = (SELECT auth.uid())
  )
  AND EXISTS (
    SELECT 1 FROM public.workspace_notifications n
    WHERE n.tenant_id = workspace_notification_reads.tenant_id
      AND n.id = workspace_notification_reads.notification_id
      AND (n.recipient_user_id IS NULL OR n.recipient_user_id = (SELECT auth.uid()))
  )
);

ALTER PUBLICATION supabase_realtime ADD TABLE public.workspace_notification_reads;

CREATE OR REPLACE FUNCTION public.count_unread_workspace_notifications(p_tenant_id uuid, p_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::integer
  FROM public.workspace_notifications n
  WHERE n.tenant_id = p_tenant_id
    AND (n.recipient_user_id IS NULL OR n.recipient_user_id = p_user_id)
    AND NOT EXISTS (
      SELECT 1
      FROM public.workspace_notification_reads r
      WHERE r.tenant_id = n.tenant_id
        AND r.notification_id = n.id
        AND r.user_id = p_user_id
    );
$$;

REVOKE ALL ON FUNCTION public.count_unread_workspace_notifications(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.count_unread_workspace_notifications(uuid, uuid) TO service_role;
