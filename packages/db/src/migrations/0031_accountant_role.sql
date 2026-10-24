-- The accountant role (tax portal). Access is still decided by permissions
-- (`tax`, `taxReport`), never by the role itself; the value only lets a user
-- carry the accountant role's grants.
ALTER TYPE "app_db"."access_control_role" ADD VALUE IF NOT EXISTS 'accountant';
