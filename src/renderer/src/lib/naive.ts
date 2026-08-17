import { createDiscreteApi } from 'naive-ui'
import { naiveTheme } from './theme'
import type { Ref } from 'vue'

export const { message, dialog, notification } = createDiscreteApi(
  ['message', 'dialog', 'notification'],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  { configProviderProps: naiveTheme as unknown as Ref<any> }
)

export function ok(text: string): void {
  message.success(text)
}

export function info(text: string): void {
  message.info(text)
}

export function fail(text: string): void {
  message.error(text)
}

export function confirmDanger(
  content: string,
  onOk: () => void,
  options?: {
    positiveText?: string
    negativeText?: string
    title?: string
    onNegativeClick?: () => void
  }
): void {
  dialog.warning({
    title: options?.title ?? '确认操作',
    content,
    positiveText: options?.positiveText ?? '确认',
    negativeText: options?.negativeText ?? '取消',
    onPositiveClick: () => {
      onOk()
    },
    onNegativeClick: () => {
      options?.onNegativeClick?.()
    },
    onClose: () => {
      options?.onNegativeClick?.()
    }
  })
}
