import { vi } from "vitest";
import { exec } from "node:child_process";

export function mockExec(stdout = "", stderr = "") {
  vi.mocked(exec).mockImplementation((_cmd: unknown, callback: unknown) => {
    (callback as (err: null, result: { stdout: string; stderr: string }) => void)(
      null,
      { stdout, stderr }
    );
    return {} as ReturnType<typeof exec>;
  });
}

export function mockExecFail(error: Error) {
  vi.mocked(exec).mockImplementation((_cmd: unknown, callback: unknown) => {
    (callback as (err: Error) => void)(error);
    return {} as ReturnType<typeof exec>;
  });
}
