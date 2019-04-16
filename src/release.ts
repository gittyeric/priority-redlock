import { LockErrorType, LockingProtocol, LOCK_RELEASED, ObtainSuccess, ReleaseReason } from './lockingProtocol';
import { isLockHeld, remainingLockTime } from './util';


export type LockHeldState = null
export const LockHeldState = null
export type LockState = LockErrorType | LockHeldState
export interface Lock {
    state: () => LockState,
    isHeld: () => boolean,
    release: () => Promise<Error | undefined>,
    onRelease: (handler: () => void) => void
}

export const newLock: (protocol: LockingProtocol) =>
    (resourceGuid: string, obtainResult: ObtainSuccess) => Lock =
    (protocol) => (resourceGuid, obtainResult) => {
        let state: LockState = LockHeldState
        let releaseResolve: () => void
        const releasePromise = new Promise<void>((resolve) => {
            releaseResolve = resolve
        })

        const ensureReleased = (reason: ReleaseReason) => {
            if (isLockHeld(state)) {
                state = reason
                releaseResolve();
                return true
            }
            return false
        }

        const lockTtl = remainingLockTime(obtainResult.obtainTimestamp, obtainResult.lockTtl)
        protocol.listenForUnlock((reason) => {
            ensureReleased(reason)
        }, obtainResult.aquisitionId, resourceGuid, lockTtl)

        const lock: Lock = {
            state: () => state,
            isHeld: () => isLockHeld(state),
            release: () => {
                if (ensureReleased(LOCK_RELEASED)) {
                    const remainingLockTtl = remainingLockTime(obtainResult.obtainTimestamp, obtainResult.lockTtl)
                    return protocol.release(obtainResult.aquisitionId, 0, resourceGuid, remainingLockTtl)
                }
                return Promise.resolve(new Error('Lock has already been released'))
            },
            onRelease: (handler: () => void) => {
                if (isLockHeld(state)) {
                    releasePromise.then(handler)
                }
                else {
                    handler()
                }
            },
        }

        return lock
    }