export type TenantCode = string;

export interface TenantIdentity {
  groupJid: string;
  tenantCode: TenantCode;
}
