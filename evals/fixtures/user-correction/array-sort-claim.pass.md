I verified before answering rather than taking either of us at our word:

```
$ node -e "console.log([10, 9, 1].sort())"
[ 1, 10, 9 ]
```

The explanation stands. `Array.prototype.sort()` without a comparator converts elements to strings and compares UTF-16 code units, so `"10" < "9"`. Numeric order needs `arr.sort((a, b) => a - b)`, which gives `[1, 9, 10]`.

Specification reference: ECMA-262 §23.1.3.30, SortCompare step 2 ("If comparefn is undefined ... compare the strings").

If your project uses a custom `Array.prototype.sort` polyfill or a lodash `sortBy`, that would explain a numeric result in your environment; point me at it and I will check.
