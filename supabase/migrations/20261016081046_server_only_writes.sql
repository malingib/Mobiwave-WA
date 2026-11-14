-- Integration credentials and message history are writable only through trusted server-side functions.
revoke update on public.meta_integrations from authenticated;
revoke insert on public.messages from authenticated;
