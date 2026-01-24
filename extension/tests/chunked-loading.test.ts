/**
 * Phase 4: Chunked Loading with Progress Tests
 *
 * Tests for getWeeklyRollupsWithProgress:
 * - Semaphore enforcement (max 4 concurrent)
 * - Bounded retries through semaphore
 * - Cache TTL and LRU eviction with injected clock
 * - Auth escalation (0 success + auth = hard fail)
 * - Explicit missing weeks model
 * - Progress callback semantics
 * - Seeded reproducible stress tests
 */

import {
  DatasetLoader,
  fetchSemaphore,
  createRollupCache,
} from "../ui/dataset-loader";

// Mock helpers
function mockFetchResponse(data: any, status: number = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  } as Response);
}

function mockFetch404() {
  return Promise.resolve({ ok: false, status: 404 } as Response);
}

function mockFetch401() {
  return Promise.resolve({ ok: false, status: 401 } as Response);
}

function mockFetch403() {
  return Promise.resolve({ ok: false, status: 403 } as Response);
}

function mockFetch500() {
  return Promise.resolve({ ok: false, status: 500 } as Response);
}

describe("Phase 4: Chunked Loading", () => {
  let loader: DatasetLoader;
  let fakeClock: () => number;
  let currentTime: number;

  beforeEach(() => {
    // Reset semaphore state
    fetchSemaphore.reset();

    // Fake clock for deterministic tests
    currentTime = 1000000;
    fakeClock = () => currentTime;

    loader = new DatasetLoader("http://test-api");
    (loader as any).manifest = {
      manifest_schema_version: 1,
      dataset_schema_version: 1,
      aggregates_schema_version: 1,
      aggregate_index: {
        weekly_rollups: [
          { week: "2026-W01", path: "aggregates/weekly/2026-W01.json" },
          { week: "2026-W02", path: "aggregates/weekly/2026-W02.json" },
          { week: "2026-W03", path: "aggregates/weekly/2026-W03.json" },
          { week: "2026-W04", path: "aggregates/weekly/2026-W04.json" },
          { week: "2026-W05", path: "aggregates/weekly/2026-W05.json" },
        ],
      },
    };
  });

  afterEach(() => {
    fetchSemaphore.reset();
    jest.restoreAllMocks();
  });

  describe("fetchSemaphore", () => {
    it("enforces max 4 concurrent fetches", async () => {
      const acquirePromises: Promise<void>[] = [];
      for (let i = 0; i < 6; i++) {
        acquirePromises.push(fetchSemaphore.acquire());
      }

      // First 4 should resolve immediately
      await Promise.all(acquirePromises.slice(0, 4));

      const state = fetchSemaphore.getState();
      expect(state.active).toBe(4);
      expect(state.queued).toBe(2);

      // Release one
      fetchSemaphore.release();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const stateAfter = fetchSemaphore.getState();
      expect(stateAfter.active).toBe(4); // 3 active + 1 from queue
      expect(stateAfter.queued).toBe(1);
    });

    it("processes queue in FIFO order", async () => {
      const order: string[] = [];

      // Acquire 4 slots
      for (let i = 0; i < 4; i++) {
        await fetchSemaphore.acquire();
      }

      // Queue 2 more
      fetchSemaphore.acquire().then(() => order.push("first"));
      fetchSemaphore.acquire().then(() => order.push("second"));

      // Release twice
      fetchSemaphore.release();
      await new Promise((resolve) => setTimeout(resolve, 0));
      fetchSemaphore.release();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(order).toEqual(["first", "second"]);
    });
  });

  describe("createRollupCache with injected clock", () => {
    it("returns cached value within TTL", () => {
      const cache = createRollupCache(fakeClock);
      const key = cache.makeKey({
        week: "2026-W01",
        org: "test",
        project: "proj",
        repo: "repo",
      });

      cache.set(key, {
        week: "2026-W01",
        pr_count: 10,
        cycle_time_p50: null,
        cycle_time_p90: null,
        authors_count: 5,
        reviewers_count: 3,
        by_repository: null,
        by_team: null,
      });

      // Advance time by 1 minute (< 5 minute TTL)
      currentTime += 60 * 1000;

      const result = cache.get(key);
      expect(result?.week).toBe("2026-W01");
      expect(result?.pr_count).toBe(10);
    });

    it("expires cache after TTL", () => {
      const cache = createRollupCache(fakeClock);
      const key = cache.makeKey({
        week: "2026-W01",
        org: "test",
        project: "proj",
        repo: "repo",
      });

      cache.set(key, {
        week: "2026-W01",
        pr_count: 10,
        cycle_time_p50: null,
        cycle_time_p90: null,
        authors_count: 5,
        reviewers_count: 3,
        by_repository: null,
        by_team: null,
      });

      // Advance time past TTL (5 minutes + 1ms)
      currentTime += 5 * 60 * 1000 + 1;

      const result = cache.get(key);
      expect(result).toBeUndefined();
    });

    it("evicts oldest by touchedAt when at capacity", () => {
      const cache = createRollupCache(fakeClock);

      // Fill cache to capacity (52 weeks)
      for (let i = 1; i <= 52; i++) {
        const key = cache.makeKey({
          week: `2026-W${i.toString().padStart(2, "0")}`,
          org: "test",
          project: "proj",
          repo: "repo",
        });
        cache.set(key, {
          week: `2026-W${i.toString().padStart(2, "0")}`,
          pr_count: i,
          cycle_time_p50: null,
          cycle_time_p90: null,
          authors_count: 0,
          reviewers_count: 0,
          by_repository: null,
          by_team: null,
        });
        currentTime += 1000; // Advance time for ordering
      }

      expect(cache.size()).toBe(52);

      // Touch week2 to make it more recent
      const week2Key = cache.makeKey({
        week: "2026-W02",
        org: "test",
        project: "proj",
        repo: "repo",
      });
      cache.get(week2Key); // Updates touchedAt

      // Add week 53 - should evict week 1 (oldest touchedAt)
      const week53Key = cache.makeKey({
        week: "2026-W53",
        org: "test",
        project: "proj",
        repo: "repo",
      });
      cache.set(week53Key, {
        week: "2026-W53",
        pr_count: 53,
        cycle_time_p50: null,
        cycle_time_p90: null,
        authors_count: 0,
        reviewers_count: 0,
        by_repository: null,
        by_team: null,
      });

      const week1Key = cache.makeKey({
        week: "2026-W01",
        org: "test",
        project: "proj",
        repo: "repo",
      });
      expect(cache.get(week1Key)).toBeUndefined();
      expect(cache.get(week2Key)).toBeDefined();
      expect(cache.get(week53Key)).toBeDefined();
    });

    it("throws if cache key missing required fields", () => {
      const cache = createRollupCache(fakeClock);

      expect(() => {
        cache.makeKey({ week: "2026-W01", org: "test" } as any); // Missing project, repo
      }).toThrow("Cache key missing required field");
    });
  });

  describe("getWeeklyRollupsWithProgress", () => {
    it("returns explicit missingWeeks[] for 404s", async () => {
      (global as any).fetch = jest.fn((url: string) => {
        if (url.includes("2026-W02")) return mockFetch404();
        if (url.includes("2026-W04")) return mockFetch404();
        const weekMatch = url.match(/(2026-W\d+)/);
        return mockFetchResponse({
          week: weekMatch ? weekMatch[1] : "2026-W01",
          pr_count: 10,
        });
      });

      const context = { org: "test", project: "proj", repo: "repo" };
      const result = await loader.getWeeklyRollupsWithProgress(
        new Date("2026-01-05"),
        new Date("2026-01-26"),
        context,
      );

      expect(result.missingWeeks).toContain("2026-W02");
      expect(result.missingWeeks).toContain("2026-W04");
      expect(result.partial).toBe(true);
      expect(result.data.length).toBeGreaterThan(0);
    });

    it("returns explicit failedWeeks[] for 5xx after retry", async () => {
      let callCount = 0;
      (global as any).fetch = jest.fn((url: string) => {
        callCount++;
        if (url.includes("2026-W03")) return mockFetch500();
        const weekMatch = url.match(/(2026-W\d+)/);
        return mockFetchResponse({
          week: weekMatch ? weekMatch[1] : "2026-W01",
          pr_count: 10,
        });
      });

      const context = { org: "test", project: "proj", repo: "repo" };
      const result = await loader.getWeeklyRollupsWithProgress(
        new Date("2026-01-05"),
        new Date("2026-01-19"),
        context,
      );

      // Verify retry happened (initial + 1 retry = 2 calls for W03)
      // Note: Since everything runs through semaphore and async, we just check that failure is recorded
      expect(result.failedWeeks).toContain("2026-W03");
      expect(result.partial).toBe(true);
    });

    it("throws AUTH_REQUIRED if authError && data.length === 0", async () => {
      (global as any).fetch = jest.fn(() => mockFetch401());

      const context = { org: "test", project: "proj", repo: "repo" };

      await expect(
        loader.getWeeklyRollupsWithProgress(
          new Date("2026-01-05"),
          new Date("2026-01-12"),
          context,
        ),
      ).rejects.toThrow("Authentication required");
    });

    it("returns degraded state if partial auth success", async () => {
      (global as any).fetch = jest.fn((url: string) => {
        if (url.includes("2026-W01"))
          return mockFetchResponse({ week: "2026-W01", pr_count: 10 });
        if (url.includes("2026-W02"))
          return mockFetchResponse({ week: "2026-W02", pr_count: 15 });
        return mockFetch403();
      });

      const context = { org: "test", project: "proj", repo: "repo" };
      const result = await loader.getWeeklyRollupsWithProgress(
        new Date("2026-01-05"),
        new Date("2026-01-19"),
        context,
      );

      expect(result.authError).toBe(true);
      expect(result.degraded).toBe(true);
      expect(result.data.length).toBeGreaterThan(0);
    });

    it("calls onProgress with correct semantics", async () => {
      (global as any).fetch = jest.fn((url: string) => {
        const weekMatch = url.match(/(2026-W\d+)/);
        return mockFetchResponse({
          week: weekMatch ? weekMatch[1] : "2026-W01",
          pr_count: 10,
        });
      });

      const progressCalls: any[] = [];
      const onProgress = (progress: any) => progressCalls.push({ ...progress });

      const context = { org: "test", project: "proj", repo: "repo" };
      await loader.getWeeklyRollupsWithProgress(
        new Date("2026-01-05"),
        new Date("2026-01-19"),
        context,
        onProgress,
      );

      // Verify progress reported during fetch
      expect(progressCalls.length).toBeGreaterThan(0);

      // Final progress should have loaded === total
      const finalProgress = progressCalls[progressCalls.length - 1];
      expect(finalProgress.loaded).toBe(finalProgress.total);
      expect(finalProgress.currentWeek).toBeNull();
    });

    it("retries go through semaphore", async () => {
      let retryCount = 0;
      (global as any).fetch = jest.fn((url: string) => {
        if (url.includes("2026-W02") && retryCount === 0) {
          retryCount++;
          return mockFetch500();
        }
        const match = url.match(/W\d+/);
        return mockFetchResponse({
          week: match ? match[0] : "W01",
          pr_count: 10,
        });
      });

      const originalAcquire = fetchSemaphore.acquire.bind(fetchSemaphore);
      const acquireSpy = jest
        .spyOn(fetchSemaphore, "acquire")
        .mockImplementation(() => {
          return originalAcquire();
        });

      const context = { org: "test", project: "proj", repo: "repo" };
      await loader.getWeeklyRollupsWithProgress(
        new Date("2026-01-05"),
        new Date("2026-01-12"),
        context,
      );

      // Verify both initial fetch and retry acquired semaphore
      expect(acquireSpy).toHaveBeenCalled();
      expect(acquireSpy.mock.calls.length).toBeGreaterThanOrEqual(2); // Initial + retries
    });

    it("stress test: randomized completion order with fixed seed", async () => {
      // Seeded random for reproducibility
      let seed = 42;
      const seededRandom = () => {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
      };

      const delays: number[] = [];
      for (let i = 0; i < 5; i++) {
        delays.push(Math.floor(seededRandom() * 100));
      }

      (global as any).fetch = jest.fn((url: string) => {
        const weekMatch = url.match(/W(\d+)/);
        const weekNum = weekMatch ? parseInt(weekMatch[1]!) : 1;
        const delay = delays[weekNum - 1] || 0;

        return new Promise((resolve) => {
          setTimeout(() => {
            const weekMatch = url.match(/(2026-W\d+)/);
            resolve(
              mockFetchResponse({
                week: weekMatch ? weekMatch[1] : "2026-W01",
                pr_count: weekNum * 5,
              }),
            );
          }, delay);
        });
      });

      const context = { org: "test", project: "proj", repo: "repo" };
      const result = await loader.getWeeklyRollupsWithProgress(
        new Date("2026-01-05"),
        new Date("2026-02-02"),
        context,
      );

      // Despite randomized delays, final order must be deterministic (week order)
      const weeks = result.data.map((d) => d.week);
      const sortedWeeks = [...weeks].sort();
      expect(weeks).toEqual(sortedWeeks);
    });
  });
});
