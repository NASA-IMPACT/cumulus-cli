/**
 * The type of value returned from a unary function used to "unfold" values via
 * the `asyncUnfold` or `asyncUnfoldFlat` function.  Either a pair of values
 * (where the first value is the next value that `*Unfold` should yield, and the
 * second value is the argument that `*Unfold` will pass to the unary function
 * to generate the next pair), or one of the "falsey" values `undefined`,
 * `null`, or `false` (indicating that unfolding is complete, and the unary
 * function should not be called again).
 *
 * @type {[T, U] | undefined | null | false}
 * @template T - type of the argument expected by the function that returns this
 *    `UnfoldResult` type
 * @template U - type of the values generated by the function that unfolds such values
 *    via an unfolding function that produces such `UnfoldResult` values
 */
type UnfoldResult<T, U> =
  | { readonly input: T; readonly output: U }
  | undefined
  | null
  | false;

/**
 * A unary function given to `asyncUnfold` or `asyncUnfoldFlat`, which is
 * expected to return an `UnfoldResult` or a `Promise` of one.
 *
 * @callback UnfoldFunction
 * @param {T} arg - the sole function argument
 * @returns {UnfoldResult<T, U> | Promise<UnfoldResult<T, U>>}
 * @template T - type of the argument expected by the function
 * @template U - type of the value returned by the function
 */
type UnfoldFunction<T, U> = (
  arg: T
) => UnfoldResult<T, U> | Promise<UnfoldResult<T, U>>;

/**
 * Returns an async generator that yields values from the specified unfolding
 * function.
 *
 * The specified function is initially invoked with the specified seed value as
 * the sole argument.  As soon as the function returns a falsy value, the
 * generator stops generating values.  Otherwise, the specified function is
 * expected to return a pair of values (2-element array).  In this case, the
 * generator yields the first item in the pair, then invokes the specified
 * function again, passing the second element in the pair to the function.
 *
 * @example
 * const f = (x) => x >= 0 && [x, x - 2];
 * const ysFrom = asyncUnfold(f);
 *
 * for await (const y of ysFrom(10)) {
 *   console.log(y);
 * }
 *
 * //=> logs each of the values 10, 8, 6, 4, 2, 0
 *
 * @param f - unary unfolding function that (possibly asynchronously) generates one
 *    item at a time
 * @returns an async generator function that yields each item generated by the
 *    unfolding function
 */
export function asyncUnfold<T, U>(f: UnfoldFunction<T, U>) {
  return async function* makeAsyncGenerator(seed: T): AsyncGenerator<U> {
    // eslint-disable-next-line functional/no-loop-statement
    for (
      // eslint-disable-next-line functional/no-let
      let input: T, output: U, result = await f(seed);
      result && ({ output, input } = result);
      result = await f(input)
    ) {
      yield output;
    }
  };
}
