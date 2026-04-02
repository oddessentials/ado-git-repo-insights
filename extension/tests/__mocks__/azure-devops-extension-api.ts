/**
 * Jest mock for azure-devops-extension-api.
 * Loaded via moduleNameMapper in jest.config.ts.
 */
export { mockApiModule as default } from "../harness/vss-sdk-mock";
export {
  mockApiModule,
} from "../harness/vss-sdk-mock";

import { mockApiModule } from "../harness/vss-sdk-mock";

export const CommonServiceIds = mockApiModule.CommonServiceIds;
export const getClient = mockApiModule.getClient;
