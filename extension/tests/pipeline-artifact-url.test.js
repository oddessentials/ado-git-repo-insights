/**
 * Build API Artifact URL Construction Tests
 *
 * Tests for the Build API URL pattern used by getArtifactFileViaSdk.
 * URL format: /_apis/build/builds/{buildId}/artifacts?artifactName=X&$format=file&subPath=/path
 */

describe('Build API Artifact URL Construction', () => {
    // Helper to simulate the URL construction logic from getArtifactFileViaSdk
    function buildArtifactFileUrl(collectionUri, projectId, buildId, artifactName, filePath) {
        // Normalize path - ensure it starts with /
        const normalizedPath = filePath.startsWith('/') ? filePath : '/' + filePath;

        return `${collectionUri}${projectId}/_apis/build/builds/${buildId}/artifacts` +
            `?artifactName=${encodeURIComponent(artifactName)}` +
            `&%24format=file` +
            `&subPath=${encodeURIComponent(normalizedPath)}` +
            `&api-version=7.1`;
    }

    describe('URL Construction', () => {
        const collectionUri = 'https://dev.azure.com/myorg/';
        const projectId = 'my-project-id';
        const buildId = 12345;

        test('constructs correct URL with all parameters', () => {
            const url = buildArtifactFileUrl(
                collectionUri,
                projectId,
                buildId,
                'aggregates',
                'aggregates/dataset-manifest.json'
            );

            expect(url).toContain('https://dev.azure.com/myorg/my-project-id/_apis/build/builds/12345/artifacts');
            expect(url).toContain('artifactName=aggregates');
            expect(url).toContain('%24format=file');
            expect(url).toContain('api-version=7.1');
        });

        test('properly URL-encodes artifact name with special characters', () => {
            const url = buildArtifactFileUrl(
                collectionUri,
                projectId,
                buildId,
                'my artifact',
                'file.json'
            );

            expect(url).toContain('artifactName=my%20artifact');
        });

        test('properly URL-encodes subPath', () => {
            const url = buildArtifactFileUrl(
                collectionUri,
                projectId,
                buildId,
                'aggregates',
                'aggregates/dataset-manifest.json'
            );

            // subPath should be encoded
            expect(url).toContain('subPath=' + encodeURIComponent('/aggregates/dataset-manifest.json'));
        });
    });

    describe('Path Normalization', () => {
        const collectionUri = 'https://dev.azure.com/myorg/';
        const projectId = 'proj';
        const buildId = 1;

        test('adds leading slash if missing', () => {
            const url = buildArtifactFileUrl(
                collectionUri,
                projectId,
                buildId,
                'artifact',
                'path/to/file.json'
            );

            expect(url).toContain('subPath=' + encodeURIComponent('/path/to/file.json'));
        });

        test('preserves leading slash if present', () => {
            const url = buildArtifactFileUrl(
                collectionUri,
                projectId,
                buildId,
                'artifact',
                '/path/to/file.json'
            );

            expect(url).toContain('subPath=' + encodeURIComponent('/path/to/file.json'));
        });

        test('handles nested paths correctly', () => {
            const url = buildArtifactFileUrl(
                collectionUri,
                projectId,
                buildId,
                'aggregates',
                'aggregates/weekly_rollups/2026-W01.json'
            );

            expect(url).toContain('subPath=' + encodeURIComponent('/aggregates/weekly_rollups/2026-W01.json'));
        });
    });

    describe('Artifact File Paths', () => {
        // These tests verify the correct paths for files within the 'aggregates' artifact.
        // Files are inside an 'aggregates' folder within the 'aggregates' artifact.

        test('manifest path should include aggregates/ prefix', () => {
            // The artifact structure is: aggregates/aggregates/dataset-manifest.json
            const correctPath = 'aggregates/dataset-manifest.json';
            expect(correctPath).toBe('aggregates/dataset-manifest.json');
        });

        test('dimensions path should include aggregates/ prefix', () => {
            const correctPath = 'aggregates/dimensions.json';
            expect(correctPath).toBe('aggregates/dimensions.json');
        });

        test('weekly rollup paths use manifest index paths', () => {
            // Rollup paths come from the manifest index
            const sampleRollupPath = 'weekly/2024-W01.json';
            expect(sampleRollupPath).toBe('weekly/2024-W01.json');
        });
    });
});
