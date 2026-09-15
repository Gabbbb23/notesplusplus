import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// findBy and waitFor default to 1 s. Whole pages that parse markdown missed that on a busy laptop.
configure({ asyncUtilTimeout: 5_000 });

afterEach(() => {
  cleanup();
});
