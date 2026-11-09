-- Application event history and status history are append-only.
CREATE OR REPLACE FUNCTION autoapply_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER application_events_append_only BEFORE UPDATE OR DELETE ON application_events
  FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION autoapply_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER application_status_history_append_only BEFORE UPDATE ON application_status_history
  FOR EACH ROW EXECUTE FUNCTION autoapply_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION autoapply_reject_mutation();
