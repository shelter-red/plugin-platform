import { createContext, Fragment, useCallback, useContext, useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import {
  Alert as MuiAlert, AlertTitle, Avatar as MuiAvatar, Box, Button as MuiButton, Card as MuiCard, CardContent, CardHeader,
  Checkbox as MuiCheckbox, Chip as MuiChip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Drawer as MuiDrawer,
  FormControl, FormControlLabel, InputAdornment, InputLabel, List as MuiList, ListItem as MuiListItem,
  ListItemButton, ListItemIcon, ListItemText, MenuItem as MuiMenuItem, Select as MuiSelect, Skeleton as MuiSkeleton,
  Snackbar, Stack, Switch as MuiSwitch, Table as MuiTable, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TextField, ToggleButton, ToggleButtonGroup, Typography as MuiTypography, useMediaQuery, useTheme,
} from '@mui/material'
import type { Breakpoint } from '@mui/material/styles'
import type { SelectChangeEvent } from '@mui/material/Select'
import type { ChangeEvent, KeyboardEvent, KeyboardEventHandler, MouseEventHandler } from 'react'

type MenuItemSpec = { key?: string; label?: ReactNode; icon?: ReactNode; extra?: ReactNode; disabled?: boolean; danger?: boolean; type?: 'divider' | 'group'; children?: MenuItemSpec[] }
export type MenuProps = { items?: MenuItemSpec[]; selectedKeys?: string[]; onClick?: (event: { key: string }) => void; className?: string; theme?: string; mode?: string; inlineCollapsed?: boolean }
export type TableColumn<T> = {
  title: ReactNode
  dataIndex?: keyof T | string
  key?: string
  width?: number | string
  responsive?: Breakpoint[]
  align?: 'left' | 'center' | 'right'
  render?: (value: any, row: T, index: number) => ReactNode
}
export type TableProps<T> = { columns?: TableColumn<T>[]; dataSource?: T[]; rowKey?: keyof T | string | ((row: T) => string); size?: 'small' | 'middle' | 'large'; loading?: boolean; pagination?: false | object; scroll?: { x?: number | string }; rowClassName?: (row: T) => string }

const NotificationContext = createContext<{
  notify: (kind: 'success' | 'error' | 'info' | 'warning', value: { message?: ReactNode; description?: ReactNode; duration?: number; placement?: string }) => void
  confirm: (options: ConfirmOptions) => void
} | null>(null)

type ConfirmOptions = { title?: ReactNode; content?: ReactNode; okText?: ReactNode; cancelText?: ReactNode; okButtonProps?: { danger?: boolean }; onOk?: () => void | Promise<void> }
function AppProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<{ kind: 'success' | 'error' | 'info' | 'warning'; message?: ReactNode; description?: ReactNode } | null>(null)
  const [confirm, setConfirm] = useState<ConfirmOptions | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const notify = useCallback((kind: 'success' | 'error' | 'info' | 'warning', value: { message?: ReactNode; description?: ReactNode }) => setNotice({ kind, ...value }), [])
  const openConfirm = useCallback((value: ConfirmOptions) => setConfirm(value), [])
  const value = useMemo(() => ({ notify, confirm: openConfirm }), [notify, openConfirm])
  const closeConfirm = () => { if (!confirmBusy) setConfirm(null) }
  const acceptConfirm = async () => {
    if (!confirm?.onOk) return setConfirm(null)
    setConfirmBusy(true)
    try { await confirm.onOk(); setConfirm(null) } finally { setConfirmBusy(false) }
  }
  return <NotificationContext.Provider value={value}>
    {children}
    <Snackbar className="ant-notification-notice" open={Boolean(notice)} autoHideDuration={notice ? 3500 : null} onClose={() => setNotice(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
      <MuiAlert elevation={4} variant="filled" severity={notice?.kind ?? 'info'} onClose={() => setNotice(null)}>
        {notice?.message}<>{notice?.description ? <span style={{ display: 'block' }}>{notice.description}</span> : null}</>
      </MuiAlert>
    </Snackbar>
    <Dialog open={Boolean(confirm)} onClose={closeConfirm} maxWidth="xs" fullWidth>
      <DialogTitle>{confirm?.title}</DialogTitle><DialogContent>{confirm?.content}</DialogContent>
      <DialogActions><MuiButton onClick={closeConfirm}>{confirm?.cancelText ?? 'Cancel'}</MuiButton><MuiButton color={confirm?.okButtonProps?.danger ? 'error' : 'primary'} variant="contained" disabled={confirmBusy} onClick={() => void acceptConfirm()}>{confirmBusy ? <CircularProgress size={16} /> : confirm?.okText ?? 'OK'}</MuiButton></DialogActions>
    </Dialog>
  </NotificationContext.Provider>
}
function useNotificationContext() {
  const value = useContext(NotificationContext)
  if (!value) throw new Error('UI App provider is missing')
  return value
}
const AppComponent = AppProvider as typeof AppProvider & { useApp: () => { notification: Record<'success' | 'error' | 'info' | 'warning', (value: { message?: ReactNode; description?: ReactNode; duration?: number; placement?: string }) => void>; modal: { confirm: (options: ConfirmOptions) => void } } }
AppComponent.useApp = () => {
  const { notify, confirm } = useNotificationContext()
  return { notification: { success: (v) => notify('success', v), error: (v) => notify('error', v), info: (v) => notify('info', v), warning: (v) => notify('warning', v) }, modal: { confirm } }
}
export const App = AppComponent

type ButtonProps = { type?: 'primary' | 'text' | 'link' | 'default' | 'dashed'; size?: 'small' | 'middle' | 'large'; icon?: ReactNode; startIcon?: ReactNode; loading?: boolean; danger?: boolean; htmlType?: 'button' | 'submit' | 'reset'; block?: boolean; onClick?: MouseEventHandler<HTMLButtonElement>; onKeyDown?: KeyboardEventHandler<HTMLButtonElement>; children?: ReactNode; [key: string]: any }
export function Button({ type, size, icon, loading, danger, children, startIcon, htmlType, block, className, ...props }: ButtonProps) {
  const variant = type === 'primary' ? 'contained' : type === 'text' || type === 'link' ? 'text' : 'outlined'
  return <MuiButton className={`ant-btn ${className ?? ''}`.trim()} type={htmlType} fullWidth={block} variant={variant} size={size === 'small' ? 'small' : size === 'large' ? 'large' : 'medium'} color={danger ? 'error' : 'primary'} startIcon={loading ? <CircularProgress size={14} /> : startIcon ?? icon} disabled={props.disabled || loading} {...props}>{children}</MuiButton>
}

export function Alert({ type = 'info', message, description, showIcon: _showIcon, action, ...props }: any) {
  return <MuiAlert severity={type} action={action} {...props} className={`ant-alert ${props.className ?? ''}`.trim()}>{message ? <AlertTitle>{message}</AlertTitle> : null}{description}</MuiAlert>
}

type CardProps = { title?: ReactNode; extra?: ReactNode; children?: ReactNode; className?: string; variant?: 'outlined' | 'elevated'; styles?: { body?: Record<string, unknown> }; hoverable?: boolean; onClick?: MouseEventHandler<HTMLDivElement>; onKeyDown?: KeyboardEventHandler<HTMLDivElement>; [key: string]: any }
export function Card({ title, extra, children, className, variant, styles, hoverable, sx, ...props }: CardProps) {
  const hoverSx = hoverable ? { transition: 'box-shadow .18s, transform .18s', '&:hover': { boxShadow: 4, transform: 'translateY(-1px)' } } : {}
  return <MuiCard className={className} variant={variant === 'outlined' ? 'outlined' : undefined} sx={{ ...hoverSx, ...sx }} {...props}>
    {title || extra ? <CardHeader title={title} action={extra} /> : null}
    <CardContent sx={styles?.body}>{children}</CardContent>
  </MuiCard>
}

type InputProps = { value?: string | number; onChange?: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void; onKeyDown?: KeyboardEventHandler<HTMLInputElement>; onPressEnter?: (event: KeyboardEvent<HTMLInputElement>) => void; type?: string; variant?: 'outlined' | 'filled' | 'standard' | 'borderless'; [key: string]: any }
const Input = Object.assign((props: InputProps) => <InputField {...props} type={props.type ?? 'text'} />, {
  Password: (props: InputProps) => <InputField {...props} type="password" />,
  Search: (props: InputProps) => <InputField {...props} />,
})
export { Input }
function InputField({ type, prefix, suffix, addonAfter, allowClear, status, onPressEnter, variant, maxLength, 'aria-label': ariaLabel, ...props }: any) {
  const inputSx = { ...(props.slotProps?.htmlInput ?? {}), ...(ariaLabel ? { 'aria-label': ariaLabel } : {}), ...(maxLength !== undefined ? { maxLength } : {}) }
  return <TextField {...props} variant={variant === 'borderless' ? 'standard' : variant ?? 'outlined'} type={type} error={status === 'error'} size={props.size === 'large' ? 'medium' : props.size === 'small' ? 'small' : 'medium'} fullWidth={props.fullWidth ?? true} onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => { if (event.key === 'Enter') onPressEnter?.(event); props.onKeyDown?.(event) }} slotProps={{ ...props.slotProps, htmlInput: inputSx, input: { startAdornment: prefix ? <InputAdornment position="start">{prefix}</InputAdornment> : undefined, endAdornment: suffix || addonAfter ? <InputAdornment position="end">{suffix ?? addonAfter}</InputAdornment> : undefined } }} />
}

type InputNumberProps = { value?: number | null; min?: number; max?: number; step?: number; onChange?: (value: number | null) => void; [key: string]: any }
export function InputNumber({ value, onChange, min, max, step, ...props }: InputNumberProps) {
  return <TextField {...props} type="number" value={value ?? ''} onChange={(event) => { const raw = event.target.value; const number = raw === '' ? null : Number(raw); if (number === null || ((min === undefined || number >= min) && (max === undefined || number <= max))) onChange?.(number) }} slotProps={{ htmlInput: { min, max, step } }} fullWidth />
}

type SelectOption = { value: string | number; label: ReactNode; disabled?: boolean }
type SelectProps<T = string> = { options?: SelectOption[]; value?: T; onChange?: (value: any, option?: any) => void; label?: ReactNode; placeholder?: string; allowClear?: boolean; size?: 'small' | 'middle' | 'large'; className?: string; disabled?: boolean; variant?: string; popupMatchSelectWidth?: boolean; [key: string]: any }
export function Select<T = string>({ options = [], value, onChange, label, placeholder, allowClear, size, className, disabled, variant, popupMatchSelectWidth: _popupWidth, 'aria-label': ariaLabel, ...props }: SelectProps<T> & { 'aria-label'?: string }) {
  const generatedId = useId()
  const selectId = props.id ?? `mui-select-${generatedId}`
  const muiVariant = (variant === 'borderless' ? 'standard' : variant ?? 'outlined') as 'standard' | 'outlined' | 'filled'
  return <FormControl fullWidth size={size === 'small' ? 'small' : 'medium'} className={`ant-select ${className ?? ''}`.trim()} disabled={disabled}>
    {label ? <InputLabel id={`${selectId}-label`}>{label}</InputLabel> : null}
    <MuiSelect className="ant-select-selection-item" id={selectId} labelId={label ? `${selectId}-label` : undefined} variant={muiVariant} label={label} value={(value ?? '') as any} displayEmpty={Boolean(placeholder)} onChange={(event: SelectChangeEvent) => onChange?.(event.target.value)} inputProps={ariaLabel ? { 'aria-label': ariaLabel } : undefined} slotProps={{ ...props.slotProps, input: ariaLabel ? { 'aria-label': ariaLabel } : undefined }} {...props}>
      {placeholder ? <MuiMenuItem value="" disabled={!allowClear}>{placeholder}</MuiMenuItem> : null}
      {options.map((option: any) => <MuiMenuItem className="ant-select-item-option" key={option.value} value={option.value} disabled={option.disabled}>{option.label}</MuiMenuItem>)}
    </MuiSelect>
  </FormControl>
}

export function Table<T>({ columns = [], dataSource = [], rowKey, size, loading, scroll, rowClassName }: TableProps<T>) {
  const muiTheme = useTheme()
  const matches = {
    xs: true,
    sm: useMediaQuery(muiTheme.breakpoints.up('sm')),
    md: useMediaQuery(muiTheme.breakpoints.up('md')),
    lg: useMediaQuery(muiTheme.breakpoints.up('lg')),
    xl: useMediaQuery(muiTheme.breakpoints.up('xl')),
  }
  const visibleColumns = columns.filter((column) => !column.responsive || column.responsive.some((breakpoint) => matches[breakpoint]))
  const keyFor = (row: T, index: number) => typeof rowKey === 'function' ? rowKey(row) : String((row as any)[rowKey ?? 'id'] ?? index)
  return <TableContainer className="ant-table-wrapper" sx={{ overflowX: 'auto', maxWidth: '100%' }}><MuiTable className="ant-table" size={size === 'small' ? 'small' : 'medium'} sx={scroll?.x ? { minWidth: scroll.x } : undefined}>
    <TableHead><TableRow>{visibleColumns.map((column, index) => <TableCell key={column.key ?? String(column.dataIndex ?? index)} align={column.align ?? 'left'} sx={{ width: column.width, fontWeight: 700 }}>{column.title}</TableCell>)}</TableRow></TableHead>
    <TableBody>{loading ? <TableRow><TableCell colSpan={visibleColumns.length}><CircularProgress size={18} /></TableCell></TableRow> : dataSource.length === 0 ? <TableRow><TableCell colSpan={visibleColumns.length} align="center">No data</TableCell></TableRow> : dataSource.map((row, rowIndex) => <TableRow hover key={keyFor(row, rowIndex)} className={rowClassName?.(row)}>{visibleColumns.map((column, columnIndex) => { const key = column.key ?? String(column.dataIndex ?? columnIndex); const raw = column.dataIndex === undefined ? undefined : (row as any)[column.dataIndex]; return <TableCell key={key} align={column.align ?? 'left'}>{column.render ? column.render(raw, row, rowIndex) : String(raw ?? '')}</TableCell> })}</TableRow>)}</TableBody>
  </MuiTable></TableContainer>
}

export function Menu({ items = [], selectedKeys = [], onClick, className, theme: _theme, mode: _mode, inlineCollapsed: _inlineCollapsed }: MenuProps) {
  const renderItems = (menuItems: MenuItemSpec[]) => menuItems.map((item) => {
    if (item.type === 'divider') return <Box key={item.key ?? 'divider'} component="hr" sx={{ border: 0, borderTop: 1, borderColor: 'divider', my: 1 }} />
    if (item.type === 'group') return <Box key={item.key} sx={{ py: 0.5 }}><MuiTypography variant="overline" color="text.secondary" sx={{ px: 2, fontSize: 11 }}>{item.label}</MuiTypography><MuiList component="div" disablePadding>{renderItems(item.children ?? [])}</MuiList></Box>
    const key = item.key ?? ''
    return <ListItemButton className={`ant-menu-item ${selectedKeys.includes(key) ? 'ant-menu-item-selected' : ''}`} key={key} selected={selectedKeys.includes(key)} disabled={item.disabled} onClick={() => onClick?.({ key })} role="menuitem">
      {item.icon ? <ListItemIcon sx={{ minWidth: 34 }}>{item.icon}</ListItemIcon> : null}<ListItemText primary={item.label} />{item.extra}
    </ListItemButton>
  })
  return <MuiList component="div" role="menu" className={`ant-menu ${className ?? ''}`.trim()} disablePadding>{renderItems(items)}</MuiList>
}

export function Dropdown({ menu, children, trigger: _trigger, placement: _placement }: any) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return <><Box component="span" onClick={(event) => setAnchor(event.currentTarget)}>{children}</Box><MuiDrawer anchor="top" open={Boolean(anchor)} onClose={() => setAnchor(null)} slotProps={{ paper: { sx: { top: anchor?.getBoundingClientRect().bottom ?? 0, left: 'auto', right: 16, width: 'max-content', height: 'auto', borderRadius: 1 } } }}>
    <MuiList role="menu" dense>{(menu?.items ?? []).map((item: any) => <ListItemButton role="menuitem" key={item.key} disabled={item.disabled} onClick={() => { menu?.onClick?.({ key: item.key }); setAnchor(null) }}><ListItemText primary={item.label} /></ListItemButton>)}</MuiList>
  </MuiDrawer></>
}

export function Drawer({ open, onClose, children, title, placement = 'left', width, className, rootClassName, styles: _styles, ...props }: any) {
  return <MuiDrawer open={open} onClose={onClose} anchor={placement} className={`${rootClassName ?? ''} ${className ?? ''} ${open ? 'ant-drawer-open' : ''}`.trim()} {...props}><Box sx={{ width: width ?? (placement === 'left' || placement === 'right' ? 320 : '100%'), height: '100%', overflow: 'auto' }}>{title ? <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider', fontWeight: 700 }}>{title}</Box> : null}{children}</Box></MuiDrawer>
}

export function Modal({ open, onCancel, onOk, title, children, footer, okText = 'OK', cancelText = 'Cancel', confirmLoading, okButtonProps, width = 520, className, destroyOnHidden: _destroyOnHidden, ...props }: any) {
  return <Dialog open={Boolean(open)} onClose={onCancel} fullWidth maxWidth={width < 600 ? 'sm' : 'md'} className={className} PaperProps={{ sx: { width: `min(${width}px, calc(100vw - 32px))` } }} {...props}>
    {title ? <DialogTitle>{title}</DialogTitle> : null}<DialogContent dividers>{children}</DialogContent>
    {footer !== null ? <DialogActions>{footer ?? <><MuiButton onClick={onCancel}>{cancelText}</MuiButton>{onOk ? <MuiButton variant="contained" onClick={onOk} disabled={confirmLoading || okButtonProps?.disabled} color={okButtonProps?.danger ? 'error' : 'primary'}>{confirmLoading ? <CircularProgress size={16} /> : okText}</MuiButton> : null}</>}</DialogActions> : null}
  </Dialog>
}

export function Popconfirm({ title, description, children, okText = 'OK', cancelText = 'Cancel', onConfirm }: any) {
  const [open, setOpen] = useState(false)
  const child = Array.isArray(children) ? children[0] : children
  return <><Box component="span" onClick={(event) => { event.stopPropagation(); setOpen(true) }}>{child}</Box><Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs"><DialogTitle>{title}</DialogTitle>{description ? <DialogContent>{description}</DialogContent> : null}<DialogActions><MuiButton onClick={() => setOpen(false)}>{cancelText}</MuiButton><MuiButton variant="contained" onClick={() => { setOpen(false); onConfirm?.() }}>{okText}</MuiButton></DialogActions></Dialog></>
}

export function Progress({ percent = 0, showInfo: _showInfo, size: _size, className, ...props }: any) { const width = `${Math.max(0, Math.min(100, percent))}%`; return <Box className={`ant-progress ${className ?? ''}`.trim()} role="progressbar" sx={{ height: 6, borderRadius: 4, bgcolor: 'action.hover', overflow: 'hidden' }} {...props}><Box style={{ width }} sx={{ height: '100%', bgcolor: 'primary.main', transition: 'width .2s' }} /></Box> }
type SegmentedProps<T extends string = string> = { options?: Array<T | { value: T; label: ReactNode }>; value?: T; onChange?: (value: T) => void; size?: 'small' | 'default'; [key: string]: any }
export function Segmented<T extends string = string>({ options = [], value, onChange, size: _size, ...props }: SegmentedProps<T>) {
  return <ToggleButtonGroup exclusive size="small" value={value} onChange={(_, next) => { if (next !== null) onChange?.(next) }} {...props}>{options.map((option: any) => { const v = typeof option === 'object' ? option.value : option; const label = typeof option === 'object' ? option.label : option; return <ToggleButton key={v} value={v}>{label}</ToggleButton> })}</ToggleButtonGroup>
}
export function Avatar({ size, shape, icon, children, ...props }: any) {
  const dimension = typeof size === 'number' ? size : size === 'large' ? 40 : size === 'small' ? 24 : 32
  return <MuiAvatar variant={shape === 'square' ? 'rounded' : 'circular'} sx={{ width: dimension, height: dimension }} {...props}>{icon ?? children}</MuiAvatar>
}
export function Tag({ color, children, ...props }: any) { return <MuiChip color={color === 'green' ? 'success' : color === 'red' ? 'error' : color === 'orange' ? 'warning' : 'default'} size="small" label={children} {...props} /> }

export function Checkbox({ checked, onChange, children, ...props }: any) {
  return <FormControlLabel control={<MuiCheckbox checked={checked} onChange={(event) => onChange?.(event.target.checked)} {...props} />} label={children} />
}
type SwitchProps = { checked?: boolean; onChange?: (checked: boolean) => void; loading?: boolean; size?: 'small' | 'default'; disabled?: boolean; inputProps?: Record<string, unknown>; [key: string]: any }
export function Switch({ checked, onChange, size: _size, loading, 'aria-label': ariaLabel, inputProps: _inputProps, ...props }: SwitchProps & { 'aria-label'?: string }) {
  return <MuiSwitch checked={checked} onChange={(event) => onChange?.(event.target.checked)} disabled={props.disabled || loading} slotProps={{ input: ariaLabel ? { 'aria-label': ariaLabel } : undefined }} {...props} />
}
export function Flex({ vertical, gap = 0, align, justify, className, children, ...props }: any) {
  const spacing = typeof gap === 'number' ? gap / 8 : gap
  return <Stack direction={vertical ? 'column' : 'row'} spacing={0} className={className} sx={{ gap: spacing, alignItems: align === 'middle' ? 'center' : align, justifyContent: justify }} {...props}>{children}</Stack>
}
type SpaceProps = { direction?: 'horizontal' | 'vertical'; size?: number | 'small' | 'middle' | 'large' | [number, number]; align?: string; wrap?: boolean; className?: string; children?: ReactNode; [key: string]: any }
const SpaceComponent = Object.assign(function Space({ direction = 'horizontal', size = 8, align, wrap, className, children, ...props }: SpaceProps) {
  const gap = Array.isArray(size) ? `${size[1]}px ${size[0]}px` : `${typeof size === 'number' ? size : size === 'small' ? 8 : size === 'large' ? 24 : 16}px`
  return <Box className={className} sx={{ display: 'flex', flexDirection: direction === 'vertical' ? 'column' : 'row', alignItems: align === 'center' ? 'center' : align, gap, flexWrap: wrap ? 'wrap' : undefined }} {...props}>{children}</Box>
}, {
  Compact: ({ block, children, ...props }: { block?: boolean; children?: ReactNode; [key: string]: any }) => <Stack direction="row" spacing={0} sx={{ width: block ? '100%' : undefined, '& > *:not(:first-of-type)': { ml: '-1px', borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }, '& > *:not(:last-child)': { borderTopRightRadius: 0, borderBottomRightRadius: 0 } }} {...props}>{children}</Stack>,
})
export const Space = SpaceComponent
export function Row({ gutter = 16, children, className, ...props }: any) {
  const gap = Array.isArray(gutter) ? `${gutter[1]}px ${gutter[0]}px` : `${gutter}px`
  return <Box className={className} sx={{ display: 'grid', gridTemplateColumns: 'repeat(24, minmax(0, 1fr))', gap }} {...props}>{children}</Box>
}
export function Col({ xs = 24, sm, md, lg, children, className, ...props }: any) {
  const theme = useTheme()
  const span = (value: number | undefined) => value ? `span ${value}` : undefined
  return <Box className={className} sx={{ gridColumn: { xs: span(xs), ...(sm ? { sm: span(sm) } : {}), ...(md ? { md: span(md) } : {}), ...(lg ? { lg: span(lg) } : {}) }, minWidth: 0, [theme.breakpoints.down('sm')]: { minWidth: 0 } }} {...props}>{children}</Box>
}

type ListProps<T> = { dataSource?: T[]; renderItem?: (item: T, index: number) => ReactNode; rowKey?: keyof T | string | ((item: T) => string); className?: string; children?: ReactNode; [key: string]: any }
function ListComponent<T = any>({ dataSource, renderItem, rowKey, className, children, ...props }: ListProps<T>) {
  return <MuiList className={className} {...props}>{dataSource ? dataSource.map((item: any, index: number) => <Fragment key={typeof rowKey === 'function' ? rowKey(item) : item?.[rowKey ?? 'key'] ?? index}>{renderItem?.(item, index)}</Fragment>) : children}</MuiList>
}
const List = Object.assign(ListComponent, { Item: MuiListItem })
export { List }

function TypographyTitle({ level = 1, ...props }: any) {
  const variant = (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'][Math.max(1, Math.min(6, level)) - 1]) as any
  return <MuiTypography variant={variant} component={variant} {...props} />
}
function TypographyText({ type, ...props }: any) {
  return <MuiTypography component="span" color={type === 'secondary' ? 'text.secondary' : type === 'danger' ? 'error.main' : undefined} {...props} />
}
const Typography = Object.assign(MuiTypography, { Title: TypographyTitle, Text: TypographyText, Paragraph: (props: any) => <MuiTypography component="p" {...props} /> })
export { Typography }

function EmptyComponent({ description, className, image, ...props }: any) {
  return <Box className={className} sx={{ py: 3, textAlign: 'center', color: 'text.secondary' }} {...props}>{image !== 'simple' ? <Box sx={{ mb: 1, fontSize: 32 }}>∅</Box> : null}{description}</Box>
}
const Empty = Object.assign(EmptyComponent, { PRESENTED_IMAGE_SIMPLE: 'simple' })
export { Empty }

function DescriptionsItem({ label, children }: any) {
  return <Box component="div" sx={{ display: 'contents' }}><MuiTypography component="dt" variant="body2" color="text.secondary">{label}</MuiTypography><MuiTypography component="dd" sx={{ m: 0 }}>{children}</MuiTypography></Box>
}
const Descriptions = Object.assign(function DescriptionsComponent({ children, column = 2, ...props }: any) {
  return <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: `minmax(100px, auto) repeat(${typeof column === 'number' ? column : 2}, minmax(0, 1fr))`, gap: 1, m: 0 }} {...props}>{children}</Box>
}, { Item: DescriptionsItem })
export { Descriptions }

export function Result({ status, icon, title, subTitle }: any) {
  return <Stack spacing={1} sx={{ alignItems: 'center', textAlign: 'center', py: 2 }}>{icon ?? <Box sx={{ fontSize: 36, color: status === 'success' ? 'success.main' : 'info.main' }}>{status === 'success' ? '✓' : 'i'}</Box>}<MuiTypography variant="h6">{title}</MuiTypography>{subTitle ? <MuiTypography color="text.secondary">{subTitle}</MuiTypography> : null}</Stack>
}
export function Skeleton({ active: _active, paragraph, ...props }: any) {
  return <Stack gap={1} {...props}><MuiSkeleton variant="text" width="42%" />{Array.from({ length: paragraph?.rows ?? 3 }, (_, index) => <MuiSkeleton key={index} variant="rounded" height={28} />)}</Stack>
}
export function Spin({ size = 'medium', tip, ...props }: any) {
  return <Stack spacing={1} sx={{ alignItems: 'center' }}><CircularProgress size={size === 'small' ? 18 : size === 'large' ? 40 : 28} {...props} />{tip ? <MuiTypography color="text.secondary">{tip}</MuiTypography> : null}</Stack>
}
export function Statistic({ title, value, suffix, formatter, precision, valueStyle, ...props }: any) {
  const formatted = formatter ? formatter(value) : typeof value === 'number' && precision !== undefined ? value.toFixed(precision) : value
  return <Stack {...props}><MuiTypography variant="body2" color="text.secondary">{title}</MuiTypography><MuiTypography variant="h4" sx={valueStyle}>{formatted}{suffix}</MuiTypography></Stack>
}

export function LayoutBase({ children, className, ...props }: any) { return <Box className={`ant-layout ${className ?? ''}`.trim()} {...props}>{children}</Box> }
function Sider({ children, collapsed, collapsedWidth = 0, trigger: _trigger, breakpoint, onBreakpoint, className, width = 256, ...props }: any) {
  const small = useMediaQuery((theme: any) => theme.breakpoints.down(breakpoint ?? 'lg'))
  useEffect(() => onBreakpoint?.(small), [small, onBreakpoint])
  const actualWidth = collapsed ? Number(collapsedWidth) || 0 : Number(width) || 256
  return <Box component="aside" className={`ant-layout-sider ${className ?? ''}`.trim()} sx={{ width: actualWidth, flex: `0 0 ${actualWidth}px`, overflow: 'hidden', transition: 'width .2s, flex-basis .2s', display: actualWidth === 0 ? 'none' : undefined }} {...props}>{children}</Box>
}
function LayoutHeader({ children, className, ...props }: any) { return <Box component="header" className={className} {...props}>{children}</Box> }
function LayoutContent({ children, className, ...props }: any) { return <Box component="main" className={className} {...props}>{children}</Box> }
export const Layout = Object.assign(LayoutBase, { Sider, Header: LayoutHeader, Content: LayoutContent })

export const ConfigProvider = ({ children }: { children: ReactNode }) => <>{children}</>
