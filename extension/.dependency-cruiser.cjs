/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
    forbidden: [
        {
            name: "no-circular",
            severity: "error",
            comment: "No circular dependencies allowed",
            from: {},
            to: {
                circular: true,
            },
        },
        {
            name: "modules-never-import-dashboard",
            severity: "error",
            comment:
                "Modules must never import dashboard.ts - violates one-way dependency rule",
            from: {
                path: "^ui/modules/",
            },
            to: {
                path: "^ui/dashboard\\.ts$",
            },
        },
        {
            name: "non-shared-modules-cross-import",
            severity: "warn",
            comment:
                "Non-shared modules should prefer importing via shared/ or types. " +
                "Exceptions: charts sub-modules may import charts.ts (shared utilities), " +
                "and charts/index.ts may re-export chart sub-modules (barrel pattern).",
            from: {
                path: "^ui/modules/(?!shared/)(?!ml/)(?!index\\.ts$).*\\.ts$",
                pathNot: "^ui/modules/charts/",
            },
            to: {
                path: "^ui/modules/(?!shared/)(?!index\\.ts$)(?!ml/types)(?!metrics).*\\.ts$",
                pathNot: "^ui/modules/charts(\\.ts|/)",
            },
        },
    ],
    options: {
        doNotFollow: {
            path: "node_modules",
        },
        tsPreCompilationDeps: true,
        tsConfig: {
            fileName: "./tsconfig.json",
        },
        enhancedResolveOptions: {
            exportsFields: ["exports"],
            conditionNames: ["import", "require", "node", "default"],
            mainFields: ["module", "main", "types"],
        },
        reporterOptions: {
            dot: {
                collapsePattern: "node_modules/(@[^/]+/[^/]+|[^/]+)",
            },
        },
    },
};
