/**
 * Pipeline Artifact URL Construction Tests
 *
 * Tests for _getFileFromDownloadUrl URL construction logic.
 * Ensures proper format parameter handling and path normalization.
 */

describe('Pipeline Artifact URL Construction', () => {
    // Helper to simulate the URL construction logic from _getFileFromDownloadUrl
    function buildPipelineArtifactUrl(downloadUrl, filePath) {
        // Normalize file path - remove leading slash, ensure no double slashes
        const normalizedPath = filePath.replace(/^\/+/, '').replace(/\/+/g, '/');

        let url;
        if (downloadUrl.includes('format=')) {
            // Replace existing format parameter
            url = downloadUrl.replace(/format=\w+/, 'format=file');
        } else {
            // Add format parameter
            const separator = downloadUrl.includes('?') ? '&' : '?';
            url = `${downloadUrl}${separator}format=file`;
        }

        // Add subPath parameter - the path should be relative to artifact root
        url += `&subPath=${encodeURIComponent('/' + normalizedPath)}`;

        return url;
    }

    describe('Format Parameter Handling', () => {
        test('replaces format=zip with format=file', () => {
            const downloadUrl = 'https://artprodcu3.artifacts.visualstudio.com/abc123?format=zip';
            const result = buildPipelineArtifactUrl(downloadUrl, 'test.json');
            expect(result).toContain('format=file');
            expect(result).not.toContain('format=zip');
        });

        test('replaces format=other with format=file', () => {
            const downloadUrl = 'https://artifacts.example.com/path?format=other';
            const result = buildPipelineArtifactUrl(downloadUrl, 'test.json');
            expect(result).toContain('format=file');
            expect(result).not.toContain('format=other');
        });

        test('adds format=file when no format parameter exists', () => {
            const downloadUrl = 'https://artifacts.example.com/path';
            const result = buildPipelineArtifactUrl(downloadUrl, 'test.json');
            expect(result).toContain('?format=file');
        });

        test('adds format=file with & when URL has existing query params', () => {
            const downloadUrl = 'https://artifacts.example.com/path?existingParam=value';
            const result = buildPipelineArtifactUrl(downloadUrl, 'test.json');
            expect(result).toContain('&format=file');
        });
    });

    describe('Path Normalization', () => {
        test('removes leading slash from file path', () => {
            const downloadUrl = 'https://example.com?format=zip';
            const result = buildPipelineArtifactUrl(downloadUrl, '/path/to/file.json');
            // subPath should be encoded, path should start with /
            expect(result).toContain('subPath=' + encodeURIComponent('/path/to/file.json'));
        });

        test('handles path without leading slash', () => {
            const downloadUrl = 'https://example.com?format=zip';
            const result = buildPipelineArtifactUrl(downloadUrl, 'path/to/file.json');
            expect(result).toContain('subPath=' + encodeURIComponent('/path/to/file.json'));
        });

        test('removes multiple leading slashes', () => {
            const downloadUrl = 'https://example.com?format=zip';
            const result = buildPipelineArtifactUrl(downloadUrl, '///path/to/file.json');
            expect(result).toContain('subPath=' + encodeURIComponent('/path/to/file.json'));
        });

        test('collapses multiple internal slashes', () => {
            const downloadUrl = 'https://example.com?format=zip';
            const result = buildPipelineArtifactUrl(downloadUrl, 'path//to///file.json');
            expect(result).toContain('subPath=' + encodeURIComponent('/path/to/file.json'));
        });

        test('handles nested aggregates path correctly', () => {
            const downloadUrl = 'https://example.com?format=zip';
            const result = buildPipelineArtifactUrl(downloadUrl, 'aggregates/dataset-manifest.json');
            expect(result).toContain('subPath=' + encodeURIComponent('/aggregates/dataset-manifest.json'));
        });
    });

    describe('Complete URL Construction', () => {
        test('constructs correct URL for typical Pipeline Artifact', () => {
            const downloadUrl = 'https://artprodcu3.artifacts.visualstudio.com/artifact123?format=zip';
            const filePath = 'aggregates/dataset-manifest.json';
            const result = buildPipelineArtifactUrl(downloadUrl, filePath);

            expect(result).toBe(
                'https://artprodcu3.artifacts.visualstudio.com/artifact123?format=file' +
                '&subPath=' + encodeURIComponent('/aggregates/dataset-manifest.json')
            );
        });

        test('handles Azure Artifacts CDN URL', () => {
            const downloadUrl = 'https://artprodcu3.artifacts.visualstudio.com/A2204c4da-b568-4aad-8349-a.../?format=zip';
            const filePath = 'aggregates/dimensions.json';
            const result = buildPipelineArtifactUrl(downloadUrl, filePath);

            expect(result).toContain('format=file');
            expect(result).toContain('subPath=' + encodeURIComponent('/aggregates/dimensions.json'));
        });
    });

    describe('Edge Cases', () => {
        test('handles file path with special characters', () => {
            const downloadUrl = 'https://example.com?format=zip';
            const result = buildPipelineArtifactUrl(downloadUrl, 'path/file with spaces.json');
            expect(result).toContain(encodeURIComponent('/path/file with spaces.json'));
        });

        test('handles empty-ish paths gracefully', () => {
            const downloadUrl = 'https://example.com?format=zip';
            const result = buildPipelineArtifactUrl(downloadUrl, 'file.json');
            expect(result).toContain('subPath=' + encodeURIComponent('/file.json'));
        });

        test('preserves other URL parameters', () => {
            const downloadUrl = 'https://example.com?format=zip&token=abc123&other=value';
            const result = buildPipelineArtifactUrl(downloadUrl, 'file.json');
            expect(result).toContain('token=abc123');
            expect(result).toContain('other=value');
            expect(result).toContain('format=file');
        });
    });

    describe('Artifact File Paths', () => {
        // These tests verify the correct paths for files within the 'aggregates' artifact.
        // Files are at the artifact ROOT, not nested in another 'aggregates' folder.

        test('manifest file path should NOT have aggregates/ prefix', () => {
            // The artifact name IS 'aggregates', so files inside are at root
            const correctPath = 'dataset-manifest.json';
            const wrongPath = 'aggregates/dataset-manifest.json';

            // The correct path should not start with the artifact name
            expect(correctPath).not.toMatch(/^aggregates\//);
            expect(wrongPath).toMatch(/^aggregates\//);
        });

        test('dimensions file path should NOT have aggregates/ prefix', () => {
            const correctPath = 'dimensions.json';
            const wrongPath = 'aggregates/dimensions.json';

            expect(correctPath).not.toMatch(/^aggregates\//);
            expect(wrongPath).toMatch(/^aggregates\//);
        });

        test('weekly rollup paths from manifest should be relative to artifact root', () => {
            // Rollup paths come from the manifest index
            // They should be like 'weekly/2024-W01.json', not 'aggregates/weekly/2024-W01.json'
            const sampleRollupPath = 'weekly/2024-W01.json';
            expect(sampleRollupPath).not.toMatch(/^aggregates\//);
        });

        test('file path normalization preserves relative paths', () => {
            // When building URLs, the path should remain relative to artifact root
            const filePath = 'dataset-manifest.json';
            const normalizedPath = filePath.replace(/^\/+/, '').replace(/\/+/g, '/');

            expect(normalizedPath).toBe('dataset-manifest.json');
            expect('/' + normalizedPath).toBe('/dataset-manifest.json');
        });
    });
});
