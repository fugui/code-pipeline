import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

export interface DrawerProps {
  visible: boolean
  onClose: () => void
  title?: React.ReactNode
  subtitle?: React.ReactNode
  extraHeader?: React.ReactNode
  footer?: React.ReactNode
  width?: number | string
  children: React.ReactNode
  destroyOnClose?: boolean
}

export const Drawer: React.FC<DrawerProps> = ({
  visible,
  onClose,
  title,
  subtitle,
  extraHeader,
  footer,
  width = 'min(840px, 92vw)',
  children,
  destroyOnClose = false
}) => {
  const [mounted, setMounted] = useState(visible)
  const [animateVisible, setAnimateVisible] = useState(false)

  useEffect(() => {
    if (visible) {
      setMounted(true)
      const timer = setTimeout(() => setAnimateVisible(true), 10)
      return () => clearTimeout(timer)
    } else {
      setAnimateVisible(false)
      const timer = setTimeout(() => setMounted(false), 300)
      return () => clearTimeout(timer)
    }
  }, [visible])

  if (!mounted && destroyOnClose) return null
  if (!mounted && !visible) return null

  const handleClose = () => {
    setAnimateVisible(false)
    setTimeout(() => {
      onClose()
    }, 300)
  }

  return createPortal(
    <div className="pipeline-app">
      {/* 1. Backdrop Overlay — Portal 到 body 以突破宿主 header 的层叠上下文 */}
      <div
        onClick={handleClose}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.45)',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
          zIndex: 99998,
          opacity: animateVisible ? 1 : 0,
          transition: 'opacity 300ms ease-out',
          pointerEvents: animateVisible ? 'auto' : 'none'
        }}
        title="点击背景区域自动关闭"
      />

      {/* 2. Slide-in Drawer Container */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: typeof width === 'number' ? `${width}px` : width,
          background: 'var(--bg-secondary, #111827)',
          borderLeft: '1px solid var(--border-color, rgba(255,255,255,0.08))',
          boxShadow: '-12px 0 36px rgba(0, 0, 0, 0.35)',
          zIndex: 99999,
          transform: animateVisible ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 300ms cubic-bezier(0.16, 1, 0.3, 1)',
          display: 'flex',
          flexDirection: 'column',
          color: 'var(--text-main, #f3f4f6)',
          overflow: 'hidden'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '24px 28px 20px 28px',
          borderBottom: '1px solid var(--border-color, rgba(255,255,255,0.08))',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          background: 'var(--bg-primary, #090d16)',
          flexShrink: 0
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {typeof title === 'string' ? (
              <h3 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: 'var(--text-main)' }}>{title}</h3>
            ) : (
              title
            )}
            {subtitle && (
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{subtitle}</div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {extraHeader}
            <button
              onClick={handleClose}
              className="btn btn-secondary btn-small"
              style={{
                padding: '6px',
                borderRadius: '50%',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer'
              }}
              title="关闭 (或点击背景区域)"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Scrollable Body */}
        <div style={{
          flex: 1,
          padding: 24,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 20
        }}>
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div style={{
            padding: '16px 24px',
            borderTop: '1px solid var(--border-color, rgba(255,255,255,0.08))',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'var(--bg-primary, #090d16)',
            flexShrink: 0
          }}>
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
