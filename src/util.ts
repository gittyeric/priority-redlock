import { pseudoRandomBytes } from 'crypto';
import { AquireOptions, defaultOptions, DefinedAquireOptions, LockError, LockErrorType, LOCK_ERROR_NAME, ObtainedFromVictim, ObtainResult, ObtainSuccess } from './lockingProtocol';
import { LockHeldState, LockState } from './release';

export const mergeWithDefaultOptions: (options?: AquireOptions) => DefinedAquireOptions =
(options?: AquireOptions) => options ? ({
    ...defaultOptions,
    ...options,
}) : { ...defaultOptions }

export function isPromise<T>(p: any): p is Promise<T> {
  return p !== null && typeof p === 'object' && typeof p.then === 'function';
}

export const promiseLastingFor: (timeoutMs: number) => Promise<void> = (timeoutMs) => {
    if (timeoutMs === 0) {
        return Promise.resolve()
    }
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve()
        }, timeoutMs)
    })
}

const BACKOFF_COUNT_CAP = 7 // Stop increasing after 2^cap
const EXP_BASE = 2
export const exponentialBackoff = (count: number) => {
    const cappedCount = Math.min(count, BACKOFF_COUNT_CAP)
    return Math.pow(EXP_BASE, cappedCount)
}

export function isLockHeld(state: LockState): state is LockHeldState {
    return state === null
}

export function isLockError(error: Error): error is LockError<any> {
    return error.name === LOCK_ERROR_NAME
}

export const isAquireSuccess = (result: ObtainResult): result is ObtainSuccess =>
    !!(result as ObtainSuccess).aquisitionId

export const isAquiredFromPeer = (result: ObtainResult): result is ObtainedFromVictim =>
    !!(result as ObtainedFromVictim).exAquisitionId

export const getNow = () => (new Date()).getTime()

export const remainingAquireTime = (fromStart: number, aquireTimeout: number) => {
    const now = getNow()
    return aquireTimeout - (now - fromStart)
}

export const remainingLockTime = (fromStart: number, lockTtl: number) => {
    const now = getNow()
    return lockTtl - (now - fromStart)
}

export const aquireWillBeExpired = (initAquireTime: number, delay: number, options: DefinedAquireOptions) =>
    (getNow() + delay >= (initAquireTime + options.aquireTimeout))


export const isAquireExpired = (initAquireTime: number, aquireTimeout: number) =>
    (remainingAquireTime(initAquireTime, aquireTimeout) <= 0)

export const randomBytes = (byteCount: number) =>
    pseudoRandomBytes(byteCount).toString()

export const newLockError: <T extends LockErrorType>(errType: T) => LockError<T> = (errType) => ({
    name: LOCK_ERROR_NAME,
    message: errType,
    code: errType,
})
