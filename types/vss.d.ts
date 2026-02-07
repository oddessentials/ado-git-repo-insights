/**
 * Type declarations for Azure DevOps Extension SDK (VSS)
 *
 * These declarations provide TypeScript types for the global VSS object
 * available in Azure DevOps extension contexts.
 */

declare namespace VSS {
    /**
     * Initialize the SDK and notify the host that the extension is ready.
     * @param options - Initialization options
     */
    function init(options?: InitOptions): void;

    /**
     * Register a callback to be invoked when the SDK is ready.
     * @param callback - Function to invoke when ready
     */
    function ready(callback: () => void): void;

    /**
     * Notify the host that the extension is loaded.
     * @param contribution - Optional contribution info
     */
    function notifyLoadSucceeded(): void;

    /**
     * Notify the host that the extension failed to load.
     * @param error - Error information
     */
    function notifyLoadFailed(error: string | Error): void;

    /**
     * Get a service from the host.
     * @param contributionId - The contribution ID of the service
     * @returns Promise resolving to the service instance
     */
    function getService<T>(contributionId: string): Promise<T>;

    /**
     * Get app token for authenticated API calls.
     */
    function getAppToken(): Promise<string>;

    /**
     * Get access token for authenticated API calls.
     */
    function getAccessToken(): Promise<{ token: string }>;

    /**
     * Get the web context (organization, project, user info).
     */
    function getWebContext(): WebContext;

    /**
     * Get the extension context.
     */
    function getExtensionContext(): ExtensionContext;

    /**
     * Get contribution from the host.
     */
    function getContribution(): Contribution;

    /**
     * Require modules from the host.
     */
    function require(modules: string[], callback: (...modules: unknown[]) => void): void;

    /**
     * Service IDs for VSS.getService()
     */
    enum ServiceIds {
        ExtensionData = "ms.vss-web.data-service"
    }

    interface InitOptions {
        explicitNotifyLoaded?: boolean;
        usePlatformStyles?: boolean;
        usePlatformScripts?: boolean;
        moduleLoaderConfig?: {
            paths?: Record<string, string>;
        };
    }

    interface WebContext {
        account: {
            id: string;
            name: string;
            uri: string;
        };
        collection: {
            id: string;
            name: string;
            uri: string;
        };
        project?: {
            id: string;
            name: string;
        };
        team?: {
            id: string;
            name: string;
        };
        user: {
            id: string;
            name: string;
            email: string;
        };
        host: {
            id: string;
            name: string;
            uri: string;
        };
    }

    interface ExtensionContext {
        extensionId: string;
        publisherId: string;
        version: string;
        baseUri: string;
    }

    interface Contribution {
        id: string;
        properties: Record<string, unknown>;
    }
}

/**
 * Global VSS object
 */
declare const VSS: {
    init: typeof VSS.init;
    ready: typeof VSS.ready;
    notifyLoadSucceeded: typeof VSS.notifyLoadSucceeded;
    notifyLoadFailed: typeof VSS.notifyLoadFailed;
    getService: typeof VSS.getService;
    getAppToken: typeof VSS.getAppToken;
    getAccessToken: typeof VSS.getAccessToken;
    getWebContext: typeof VSS.getWebContext;
    getExtensionContext: typeof VSS.getExtensionContext;
    getContribution: typeof VSS.getContribution;
    require: typeof VSS.require;
    ServiceIds: typeof VSS.ServiceIds;
};

/**
 * Extension Data Service for storing/retrieving extension settings.
 */
interface IExtensionDataService {
    getValue<T>(key: string, options?: { scopeType?: string; scopeValue?: string }): Promise<T | undefined>;
    setValue<T>(key: string, value: T, options?: { scopeType?: string; scopeValue?: string }): Promise<T>;
    getDocument(collectionName: string, id: string): Promise<unknown>;
    setDocument(collectionName: string, doc: unknown): Promise<unknown>;
    createDocument(collectionName: string, doc: unknown): Promise<unknown>;
    deleteDocument(collectionName: string, id: string): Promise<void>;
}

/**
 * Global declarations for browser environment.
 */
declare const window: Window & typeof globalThis & {
    VSS: typeof VSS;
    __DASHBOARD_DEBUG__?: boolean;
    __dashboardMetrics?: unknown;
    __LOCAL_DATASET_PATH__?: string;
};
