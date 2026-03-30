/**
 * Jest mock for azure-devops-extension-sdk.
 * Loaded via moduleNameMapper in jest.config.ts.
 */
export { mockSdkModule as default } from "../harness/vss-sdk-mock";
export {
  mockSdkModule,
} from "../harness/vss-sdk-mock";

// Re-export named functions from the mock module for direct imports
import { mockSdkModule } from "../harness/vss-sdk-mock";

export const init = mockSdkModule.init;
export const ready = mockSdkModule.ready;
export const notifyLoadSucceeded = mockSdkModule.notifyLoadSucceeded;
export const notifyLoadFailed = mockSdkModule.notifyLoadFailed;
export const getWebContext = mockSdkModule.getWebContext;
export const getUser = mockSdkModule.getUser;
export const getHost = mockSdkModule.getHost;
export const getExtensionContext = mockSdkModule.getExtensionContext;
export const getAccessToken = mockSdkModule.getAccessToken;
export const getAppToken = mockSdkModule.getAppToken;
export const getTeamContext = mockSdkModule.getTeamContext;
export const getService = mockSdkModule.getService;
export const getConfiguration = mockSdkModule.getConfiguration;
export const getContributionId = mockSdkModule.getContributionId;
export const register = mockSdkModule.register;
export const unregister = mockSdkModule.unregister;
export const resize = mockSdkModule.resize;
export const applyTheme = mockSdkModule.applyTheme;
export const sdkVersion = mockSdkModule.sdkVersion;
export const getPageContext = mockSdkModule.getPageContext;
