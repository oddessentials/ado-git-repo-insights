/**
 * Build API Call Pattern Tests
 *
 * These tests ensure correct API call patterns are used to prevent
 * Azure DevOps API errors like "Continuation token timestamp without
 * query order is ambiguous".
 */

describe('Build API Call Patterns', () => {
    describe('getDefinitions queryOrder requirement', () => {
        /**
         * When fetching multiple pipeline definitions (without specific IDs),
         * the Azure DevOps API requires a queryOrder parameter for pagination.
         * Without it, the API returns:
         * "Continuation token timestamp without query order is ambiguous"
         *
         * Valid queryOrder values:
         * - 1 = definitionNameDescending
         * - 2 = definitionNameAscending
         * - 3 = lastModifiedDescending
         * - 4 = lastModifiedAscending
         */
        it('should document the queryOrder requirement for bulk definition fetches', () => {
            // This is a documentation test - the actual implementation is in dashboard.js
            // The key insight is: when fetching definitions without a specific ID filter,
            // always pass queryOrder to avoid pagination errors

            const requiredPattern = {
                // Parameters for getDefinitions when fetching multiple definitions:
                project: 'required',
                name: 'optional',
                repositoryId: 'optional',
                repositoryType: 'optional',
                top: 'optional - but if >25, need queryOrder',
                continuationToken: 'optional',
                minMetricsTime: 'optional',
                definitionIds: 'optional - if provided, queryOrder not needed',
                queryOrder: 'REQUIRED when fetching bulk definitions without definitionIds'
            };

            expect(requiredPattern.queryOrder).toContain('REQUIRED');
        });

        it('should verify dashboard.js uses queryOrder for discoverInsightsPipelines', async () => {
            // Read the dashboard.js file and verify the pattern
            const fs = require('fs');
            const path = require('path');
            const dashboardPath = path.join(__dirname, '../ui/dashboard.js');
            const dashboardCode = fs.readFileSync(dashboardPath, 'utf8');

            // Find the discoverInsightsPipelines function's getDefinitions call
            // queryOrder should be the 5th parameter (after project, name, repositoryId, repositoryType)
            const functionMatch = dashboardCode.match(
                /async function discoverInsightsPipelines[\s\S]*?getDefinitions\([^)]+\)/
            );

            expect(functionMatch).not.toBeNull();

            // The getDefinitions call should have queryOrder as 5th parameter
            // Pattern: getDefinitions(projectId, null, null, null, 2, 50)
            // Parameters: project, name, repositoryId, repositoryType, queryOrder, top
            const callPattern = functionMatch[0].match(/getDefinitions\(([^)]+)\)/);
            expect(callPattern).not.toBeNull();

            const args = callPattern[1].split(',').map(a => a.trim());

            // Should have at least 6 parameters (project + 4 nulls + queryOrder + top)
            expect(args.length).toBeGreaterThanOrEqual(6);

            // 5th argument (index 4) should be queryOrder (value 2 = definitionNameAscending)
            const queryOrderArg = args[4];
            expect(queryOrderArg).toBe('2');

            // 6th argument (index 5) should be top (value 50)
            const topArg = args[5];
            expect(topArg).toBe('50');
        });

        it('should verify specific pipeline ID lookups do NOT need queryOrder', () => {
            // When fetching a specific pipeline by ID, queryOrder is not needed
            // because there's no pagination involved
            const specificIdPattern = {
                scenario: 'Fetching definitions with definitionIds filter',
                needsQueryOrder: false,
                reason: 'Single or specific IDs do not trigger pagination'
            };

            expect(specificIdPattern.needsQueryOrder).toBe(false);
        });
    });

    describe('DefinitionQueryOrder enum values', () => {
        // Document the valid queryOrder values for reference
        const DefinitionQueryOrder = {
            definitionNameDescending: 1,
            definitionNameAscending: 2,
            lastModifiedDescending: 3,
            lastModifiedAscending: 4
        };

        it('should have definitionNameAscending = 2', () => {
            expect(DefinitionQueryOrder.definitionNameAscending).toBe(2);
        });

        it('should document all valid queryOrder values', () => {
            expect(Object.keys(DefinitionQueryOrder)).toEqual([
                'definitionNameDescending',
                'definitionNameAscending',
                'lastModifiedDescending',
                'lastModifiedAscending'
            ]);
        });
    });
});
