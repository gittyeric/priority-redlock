import { promiseLastingFor, isPromise } from "../src/util";
import { isError } from "util";

export const nestedPromiseTransaction = <RESOURCE>(error?: Error) =>
    function* (r: RESOURCE) {
        yield promiseLastingFor(1).then(() => {
            if (error) {
                throw error
            }
        });
        return true
    }

export interface ResourceSpy<RESOURCE> {
    set: (newVal: RESOURCE) => void,
    get: () => RESOURCE,
}

export const newIntSpy: () => ResourceSpy<number> = () => {
    let i = 0;
    return {
        set: (newVal: number) => { i = newVal; },
        get: () => i,
    }
}

export const newIntSetterTransaction = (intsToSet: (number | Error | Promise<Error>)[], msBetweenSets: number) =>
    function* (r: ResourceSpy<number>) {
        for (let i = 0; i < intsToSet.length; i++) {
            const next = intsToSet[i]
            if (isError(next)) {
                throw next
            }
            if (isPromise(next)) {
                yield next.then((e) => {
                    throw e
                })
            }
            else {
                yield promiseLastingFor(msBetweenSets)
                    .then(() => {
                        r.set(next)
                    })
            }
        }
        return r.get()
    }