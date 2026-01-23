/**
 * Task Node Handler Configuration Tests
 *
 * Ensures the Azure DevOps task uses only supported Node.js runners.
 * This prevents regression to deprecated handlers (Node16, Node10, Node6).
 *
 * Reference: https://aka.ms/node-runner-guidance
 */
import * as fs from "fs";
import * as path from "path";

describe("Task Node Handler Configuration", () => {
    const taskJsonPath = path.join(
        __dirname,
        "..",
        "tasks",
        "extract-prs",
        "task.json",
    );
    let taskConfig: any;

    beforeAll(() => {
        taskConfig = JSON.parse(fs.readFileSync(taskJsonPath, "utf-8"));
    });

    describe("Supported Handlers", () => {
        it("must have Node20 execution handler", () => {
            expect(taskConfig.execution.Node20).toBeDefined();
            expect(taskConfig.execution.Node20.target).toBe("index.js");
        });
    });

    describe("Deprecated Handlers (must NOT exist)", () => {
        it("must NOT have deprecated Node16 handler", () => {
            expect(taskConfig.execution.Node16).toBeUndefined();
        });

        it("must NOT have deprecated Node10 handler", () => {
            expect(taskConfig.execution.Node10).toBeUndefined();
        });

        it("must NOT have deprecated Node handler (Node6)", () => {
            // Legacy Node handler was for Node 6
            expect(taskConfig.execution.Node).toBeUndefined();
        });
    });
});
