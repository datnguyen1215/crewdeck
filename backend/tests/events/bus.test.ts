import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventBus, eventBus } from "../../src/events/bus.js";

describe("EventBus", () => {
  describe("singleton", () => {
    it("returns the same instance on repeated imports", async () => {
      const { eventBus: bus2 } = await import("../../src/events/bus.js");
      expect(eventBus).toBe(bus2);
    });
  });

  describe("emit / on / off", () => {
    let bus: EventBus;

    beforeEach(() => {
      bus = new EventBus();
    });

    it("calls registered handler with correct data", () => {
      const handler = vi.fn();
      bus.on("issue.status_changed", handler);
      bus.emit("issue.status_changed", {
        issue_id: "i1",
        project_id: "p1",
        from: "open",
        to: "in_progress",
      });
      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith({
        issue_id: "i1",
        project_id: "p1",
        from: "open",
        to: "in_progress",
      });
    });

    it("calls multiple handlers for the same event", () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      bus.on("agent.idle", h1);
      bus.on("agent.idle", h2);
      bus.emit("agent.idle", { agent_id: "a1", project_id: "p1" });
      expect(h1).toHaveBeenCalledOnce();
      expect(h2).toHaveBeenCalledOnce();
    });

    it("does not call handlers for a different event", () => {
      const handler = vi.fn();
      bus.on("agent.idle", handler);
      bus.emit("pr.status_changed", { pr_id: "pr1", project_id: "p1", from: "open", to: "closed" });
      expect(handler).not.toHaveBeenCalled();
    });

    it("off() removes a specific handler", () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      bus.on("agent.idle", h1);
      bus.on("agent.idle", h2);
      bus.off("agent.idle", h1);
      bus.emit("agent.idle", { agent_id: "a1", project_id: "p1" });
      expect(h1).not.toHaveBeenCalled();
      expect(h2).toHaveBeenCalledOnce();
    });

    it("off() has no effect for an unregistered handler", () => {
      const handler = vi.fn();
      // Should not throw
      expect(() => bus.off("agent.idle", handler)).not.toThrow();
    });
  });

  describe("error isolation", () => {
    let bus: EventBus;

    beforeEach(() => {
      bus = new EventBus();
    });

    it("continues calling subsequent handlers when one throws", () => {
      const failing = vi.fn(() => {
        throw new Error("boom");
      });
      const succeeding = vi.fn();
      bus.on("agent.idle", failing);
      bus.on("agent.idle", succeeding);
      bus.emit("agent.idle", { agent_id: "a1", project_id: "p1" });
      expect(failing).toHaveBeenCalledOnce();
      expect(succeeding).toHaveBeenCalledOnce();
    });

    it("does not throw when a handler fails", () => {
      bus.on("agent.idle", () => {
        throw new Error("boom");
      });
      expect(() =>
        bus.emit("agent.idle", { agent_id: "a1", project_id: "p1" })
      ).not.toThrow();
    });

    it("logs an error when a handler fails", async () => {
      const { logger } = await import("../../src/logger.js");
      const logSpy = vi.spyOn(logger, "error");
      bus.on("agent.idle", () => {
        throw new Error("handler error");
      });
      bus.emit("agent.idle", { agent_id: "a1", project_id: "p1" });
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({ event: "agent.idle" }),
        "Event handler failed"
      );
      logSpy.mockRestore();
    });
  });
});
