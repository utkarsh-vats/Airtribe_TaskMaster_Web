import type { Ref, RefCallback } from 'react';

/** Combine refs (object or callback) into one callback ref. */
export function mergeRefs<T>(...refs: (Ref<T> | undefined)[]): RefCallback<T> {
    return (node) => {
        for (const ref of refs) {
            if (typeof ref === 'function') ref(node);
            else if (ref) ref.current = node;
        }
    };
}
