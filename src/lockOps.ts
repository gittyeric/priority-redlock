import { LOCK_AQUIRE_TIMEOUT, LockErrorType } from './lockingProtocol';
import { Lock } from './release';
import { getNow, isAquireExpired, isLockHeld, newLockError } from './util';

const combineLocks = (lock1: Lock, lock2: Lock) => {
    const state = () => {
        if (lock1.state() === lock2.state()) {
            return lock1.state()
        }
        // Mixed Error state, returns arbitrary lock error
        if (!isLockHeld(lock1.state())) {
            return lock1.state()
        }
        return lock2.state()
    }
    const combinationLock: Lock = {
        state,
        isHeld: () => isLockHeld(state()),
        onRelease: (handler: () => void) => {
            lock1.onRelease(handler)
            lock2.onRelease(handler)
        },
        release: () => {
            return Promise.all([lock1.release(), lock2.release()])
                .then(() => undefined)
        },
    }
    return combinationLock
}

// Create a Lock composed of holding N locks.
// WATCH OUT for deadlocks!
// Pass in lock requests in most to least contended order
// totalAquireTtl covers aquiring all locks
export const aquireAll = (aquirers: (() => Promise<Lock>)[], totalAquireTtl: number): Promise<Lock> => {
    if (aquirers.length === 0) {
        return Promise.reject('No aquirers were provided')
    }

    const initAquireTime = getNow()
    const aquiredLocks: Lock[] = []

    const destroy = () => {
        aquiredLocks.forEach((lock) => lock.release()
            .catch((e) => { })) // Swallow release errors
    }

    const listenForDestruction = (lock: Lock) => {
        lock.onRelease(() => {
            destroy()
        })
    }

    const queuedAquires = [...aquirers]
    queuedAquires.reverse()
    const popNext: () => Promise<Lock> = () => {
        const next = queuedAquires.pop() as () => Promise<Lock>
        const pending = next()
        return pending.then((ready: Lock) => {
            aquiredLocks.push(ready)
            if (isAquireExpired(initAquireTime, totalAquireTtl)) {
                destroy()
                return Promise.reject(newLockError(LOCK_AQUIRE_TIMEOUT))
            }
            // Look for losing previous locks
            const lostLocks = aquiredLocks.filter((lock) =>
                !isLockHeld(lock.state()))
            if (lostLocks.length > 0) {
                destroy()
                return Promise.reject(newLockError(lostLocks[0].state() as LockErrorType))
            }

            listenForDestruction(ready)

            if (queuedAquires.length > 0) {
                return popNext()
            }
            // If done, wrap up all the individually held locks
            let tailLock = aquiredLocks[0]
            for (let i = 1; i < aquiredLocks.length; i++) {
                tailLock = combineLocks(tailLock, aquiredLocks[i])
            }
            return tailLock
        })
            .catch((e) => {
                return Promise.reject(e)
            })
    }

    return popNext()
}
