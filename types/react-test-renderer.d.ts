/**
 * Minimal types for `react-test-renderer`, which ships none of its own.
 *
 * Declared here rather than pulling in `@types/react-test-renderer`: the
 * renderer is used by two test files for exactly the surface below, and a
 * `@types` package would be a dependency change for something the repo can
 * state in fifteen lines. Widen it if a test needs more.
 */
declare module 'react-test-renderer' {
  import type { ReactElement } from 'react';

  export interface ReactTestInstance {
    type: unknown;
    props: Record<string, any>;
    children: (ReactTestInstance | string)[];
    findAllByType(type: unknown): ReactTestInstance[];
    findByType(type: unknown): ReactTestInstance;
    findByProps(props: Record<string, unknown>): ReactTestInstance;
  }

  /** A rendered host element, as `toJSON` reports it. */
  export interface ReactTestRendererJSON {
    type: string;
    props: Record<string, any>;
    children: (ReactTestRendererJSON | string)[] | null;
  }

  export interface ReactTestRenderer {
    root: ReactTestInstance;
    toJSON(): ReactTestRendererJSON | ReactTestRendererJSON[] | null;
    unmount(): void;
    update(element: ReactElement): void;
  }

  export function create(element: ReactElement): ReactTestRenderer;
  export function act(callback: () => void | Promise<void>): void;
}
