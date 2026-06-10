import { randomBytes } from "node:crypto";

import { TenantGroupRepository } from "../../repositories/tenantGroup.repository";

const TENANT_CODE_PREFIX = "MNJ";
const TENANT_CODE_RANDOM_BYTES = 2;
const MAX_GENERATE_ATTEMPTS = 20;

export class TenantCodeService {
  constructor(private readonly tenantGroupRepository = new TenantGroupRepository()) {}

  async generateUniqueCode(): Promise<string> {
    for (let attempt = 0; attempt < MAX_GENERATE_ATTEMPTS; attempt += 1) {
      const code = this.generateCode();
      const existingTenant = await this.tenantGroupRepository.findByTenantCode(code);

      if (!existingTenant) {
        return code;
      }
    }

    throw new Error("Gagal membuat kode tenant unik");
  }

  private generateCode(): string {
    return `${TENANT_CODE_PREFIX}-${randomBytes(TENANT_CODE_RANDOM_BYTES).toString("hex").toUpperCase()}`;
  }
}

export const tenantCodeService = new TenantCodeService();
