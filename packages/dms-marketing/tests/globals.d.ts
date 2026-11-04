/** The globals mocha gives every file under `tests/` when `ajs module test` runs the suite. */
interface TestContext {
  timeout(milliseconds: number): void;
}

type TestBody = (this: TestContext) => void | Promise<void>;

declare function describe(title: string, suite: () => void): void;
declare function it(title: string, body: TestBody): void;
declare function before(hook: TestBody): void;
declare function after(hook: TestBody): void;
declare function beforeEach(hook: TestBody): void;
declare function afterEach(hook: TestBody): void;
