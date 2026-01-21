/**
 * Artifact Client for PR Insights Hub
 *
 * Provides authenticated access to Azure DevOps pipeline artifacts.
 * Uses the ADO Extension SDK for proper authentication.
 *
 * IMPORTANT: In ADO extension context, plain fetch() will return 401.
 * We must use the SDK's auth token service.
 */
import { IDatasetLoader } from './dataset-loader';
/**
 * Client for accessing pipeline artifacts with authentication.
 */
export declare class ArtifactClient {
    readonly projectId: string;
    private collectionUri;
    private authToken;
    private initialized;
    /**
     * Create a new ArtifactClient.
     *
     * @param projectId - Azure DevOps project ID
     */
    constructor(projectId: string);
    /**
     * Initialize the client with ADO SDK auth.
     * MUST be called after VSS.ready() and before any other methods.
     *
     * @returns This client instance
     */
    initialize(): Promise<ArtifactClient>;
    /**
     * Ensure the client is initialized.
     */
    private _ensureInitialized;
    /**
     * Fetch a file from a build artifact.
     *
     * @param buildId - Build ID
     * @param artifactName - Artifact name (e.g., 'aggregates')
     * @param filePath - Path within artifact (e.g., 'dataset-manifest.json')
     * @returns Parsed JSON content
     * @throws {PrInsightsError} On permission denied or not found
     */
    getArtifactFile(buildId: number, artifactName: string, filePath: string): Promise<any>;
    /**
     * Check if a specific file exists in an artifact.
     */
    hasArtifactFile(buildId: number, artifactName: string, filePath: string): Promise<boolean>;
    /**
     * Get artifact metadata by looking it up from the artifacts list.
     */
    getArtifactMetadata(buildId: number, artifactName: string): Promise<any | null>;
    /**
     * Get artifact content via SDK approach.
     */
    getArtifactFileViaSdk(buildId: number, artifactName: string, filePath: string): Promise<any>;
    /**
     * Get list of artifacts for a build.
     */
    getArtifacts(buildId: number): Promise<any[]>;
    /**
     * Create a DatasetLoader that uses this client for authenticated requests.
     */
    createDatasetLoader(buildId: number, artifactName: string): AuthenticatedDatasetLoader;
    /**
     * Build the URL for accessing a file within an artifact.
     */
    private _buildFileUrl;
    /**
     * Perform an authenticated fetch using the ADO auth token.
     */
    protected _authenticatedFetch(url: string, options?: RequestInit): Promise<Response>;
}
/**
 * DatasetLoader that uses ArtifactClient for authenticated requests.
 */
export declare class AuthenticatedDatasetLoader implements IDatasetLoader {
    private readonly artifactClient;
    private readonly buildId;
    private readonly artifactName;
    private manifest;
    private dimensions;
    private rollupCache;
    private distributionCache;
    constructor(artifactClient: ArtifactClient, buildId: number, artifactName: string);
    loadManifest(): Promise<any>;
    validateManifest(manifest: any): void;
    loadDimensions(): Promise<any>;
    getWeeklyRollups(startDate: Date, endDate: Date): Promise<any[]>;
    getDistributions(startDate: Date, endDate: Date): Promise<any[]>;
    getWeeksInRange(startDate: Date, endDate: Date): string[];
    getISOWeek(date: Date): string;
    getCoverage(): any;
    getDefaultRangeDays(): number;
    loadPredictions(): Promise<any>;
    loadInsights(): Promise<any>;
}
/**
 * Mock implementation for testing.
 */
export declare class MockArtifactClient {
    readonly projectId: string;
    initialized: boolean;
    private mockData;
    constructor(mockData?: Record<string, any>);
    initialize(): Promise<MockArtifactClient>;
    getArtifactFile(buildId: number, artifactName: string, filePath: string): Promise<any>;
    hasArtifactFile(buildId: number, artifactName: string, filePath: string): Promise<boolean>;
    getArtifacts(buildId: number): Promise<any[]>;
    createDatasetLoader(buildId: number, artifactName: string): AuthenticatedDatasetLoader;
}
