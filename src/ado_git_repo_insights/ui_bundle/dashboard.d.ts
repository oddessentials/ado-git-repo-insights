/**
 * PR Insights Dashboard
 *
 * Project-level hub that loads data from pipeline artifacts.
 * Uses Azure DevOps Extension SDK for authentication.
 *
 * Configuration precedence:
 * 1. ?dataset=<url> - Direct URL (DEV ONLY)
 * 2. ?pipelineId=<id> - Query parameter override
 * 3. Extension settings - User-scoped saved preference
 * 4. Auto-discovery - Find pipelines with 'aggregates' artifact
 */
export {};
