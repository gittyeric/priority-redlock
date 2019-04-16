export type Handler<HANDLE_TYPE> = (handled: HANDLE_TYPE, eventType: string) => void
export interface Handlers<HANDLED> {
  [eventKey: string]: Handler<HANDLED>[]
}

export type Off = () => void
export interface Dispatcher<HANDLED> {
  on: (eventType: string, handler: Handler<HANDLED>) => Off,
  once: (eventType: string, handler: Handler<HANDLED>) => Off,
  dispatch: (eventType: string, obj: HANDLED) => void,
}

export function newDispatcher<HANDLED>(): Dispatcher<HANDLED> {
  const handlerMap: Handlers<HANDLED> = {};
  
  const on = (eventType: string, handler: Handler<HANDLED>) => {
    const handlers = handlerMap.hasOwnProperty(eventType) ?
      handlerMap[eventType] :
      []

    handlers.push(handler);
    handlerMap[eventType] = handlers

    const off = () => {
      const handlerIndex = handlers.indexOf(handler)
      if (handlerIndex >= 0) {
        handlers.splice(handlerIndex, 1)
      }
    }

    return off
  };

  const once = (eventType: string, handler: Handler<HANDLED>) => {
      const off = on(eventType, (handled, eventType) => {
          handler(handled, eventType)
          off()
      })
      return off
  }

  const dispatch = (eventType: string, obj: HANDLED) => {
    const handlers = handlerMap[eventType]
    if (handlers) {
      handlers.forEach((handler) => handler(obj, eventType))
    }
  }

  return {
    on, once, dispatch,
  }
}