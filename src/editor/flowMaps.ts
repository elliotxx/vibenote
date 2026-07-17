import { EditorSelection, StateEffect, StateField, type EditorState } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { blockField, type ScratchBlock } from './blocks'

type FlowPath = {
  depth: number
  startStage: number
  lineNumber: number
  nodes: string[]
}

type FlowSection = {
  root: string
  lineNumber: number
  leadingBlankLineNumbers: number[]
  mainArrowColumns: number[]
  paths: FlowPath[]
}

type FlowGroup = {
  from: number
  to: number
  replaceTo: number
  activeBlock: boolean
  blockParity: 'even' | 'odd'
  sections: FlowSection[]
}

type FlowMapState = {
  editing: { from: number; to: number } | null
  decorations: DecorationSet
}

const setEditingFlow = StateEffect.define<{ from: number; to: number } | null>({
  map(value, changes) {
    if (!value) return null
    return {
      from: changes.mapPos(value.from),
      to: changes.mapPos(value.to),
    }
  },
})

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
const FLOW_EDGE_GAP = 10
const FLOW_CONNECTOR_LENGTH = 30
const FLOW_SPLIT_TAIL_LENGTH = 20
let flowMarkerSequence = 0

type FlowMapDOM = HTMLDivElement & {
  flowCleanup?: () => void
}

type FlowEdgeSetup = {
  stage: HTMLElement
  canvas: HTMLElement
  svg: SVGSVGElement
  edgeGroup: SVGGElement
  markerId: string
}

function createSvgElement<K extends keyof SVGElementTagNameMap>(name: K) {
  return document.createElementNS(SVG_NAMESPACE, name)
}

function createFlowLineNumber(value: number, rowId?: string) {
  const lineNumber = document.createElement('span')
  lineNumber.className = 'markdown-flow-line-number'
  lineNumber.textContent = String(value)
  lineNumber.setAttribute('aria-hidden', 'true')
  if (rowId) lineNumber.dataset.flowRowTarget = rowId
  return lineNumber
}

function setupFlowEdges(
  stage: HTMLElement,
  canvas: HTMLElement,
  svg: SVGSVGElement,
  edgeGroup: SVGGElement,
  markerId: string,
) {
  let animationFrame = 0

  const render = () => {
    animationFrame = 0
    const stageRect = stage.getBoundingClientRect()
    const lanes = Array.from(canvas.querySelectorAll<HTMLElement>('.markdown-flow-lane'))
    if (!stageRect.width || !stageRect.height || lanes.length === 0) return

    const deviceScale = window.devicePixelRatio || 1
    const snap = (value: number) => Math.round(value * deviceScale) / deviceScale
    const localRect = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect()
      return {
        element,
        left: snap(rect.left - stageRect.left),
        right: snap(rect.right - stageRect.left),
        centerY: snap(rect.top - stageRect.top + rect.height / 2),
      }
    }
    const laneGeometry = lanes.map(lane => ({
      lane,
      startStage: Number(lane.dataset.flowStartStage || 1),
      nodes: Array.from(lane.querySelectorAll<HTMLElement>('.markdown-flow-map-node')).map(node => ({
        ...localRect(node),
        stage: Number(node.dataset.flowStage || 1),
      })),
    }))
    if (laneGeometry.some(lane => lane.nodes.length === 0)) return

    const width = stage.clientWidth
    const height = stage.clientHeight
    svg.setAttribute('width', String(width))
    svg.setAttribute('height', String(height))
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
    edgeGroup.replaceChildren()

    const appendEdge = (
      data: string,
      kind: string,
      arrow = false,
      laneIndex?: number,
      targetStage?: number,
    ) => {
      const edge = createSvgElement('path')
      edge.classList.add('markdown-flow-edge')
      edge.dataset.flowEdge = kind
      if (laneIndex !== undefined) edge.dataset.flowLane = String(laneIndex)
      if (targetStage !== undefined) edge.dataset.flowTargetStage = String(targetStage)
      edge.setAttribute('d', data)
      if (arrow) edge.setAttribute('marker-end', `url(#${markerId})`)
      edgeGroup.append(edge)
      return edge
    }

    const mainLane = laneGeometry[0]
    const narrowLayout = window.matchMedia('(max-width: 520px)').matches
    const joints: Array<{ kind: string; x: number; y: number }> = []
    const mainByStage = new Map(mainLane.nodes.map(node => [node.stage, node]))
    const branchGroups = new Map<number, Array<{ laneIndex: number; node: typeof mainLane.nodes[number] }>>()
    for (const [laneIndex, geometry] of laneGeometry.entries()) {
      for (const [nodeIndex, node] of geometry.nodes.entries()) {
        const endX = snap(node.left - FLOW_EDGE_GAP)
        const startX = snap(endX - FLOW_CONNECTOR_LENGTH)
        appendEdge(
          `M ${startX} ${node.centerY} H ${endX}`,
          nodeIndex === 0 ? (laneIndex === 0 ? 'main' : 'branch') : 'between',
          true,
          laneIndex,
          node.stage,
        )
        if (nodeIndex === 0 && laneIndex > 0) {
          const group = branchGroups.get(node.stage) || []
          group.push({ laneIndex, node })
          branchGroups.set(node.stage, group)
        }
      }
    }

    for (const [stageNumber, branches] of branchGroups) {
      const mainNode = mainByStage.get(stageNumber)
      if (!mainNode) continue
      const mainTrackX = snap(mainNode.left - FLOW_EDGE_GAP - FLOW_CONNECTOR_LENGTH)
      const lastBranch = branches.at(-1)!.node
      const branchTrackX = snap(lastBranch.left - FLOW_EDGE_GAP - FLOW_CONNECTOR_LENGTH)
      const sourceNode = mainByStage.get(stageNumber - 1)
      if (!narrowLayout) {
        const tailStartX = sourceNode
          ? snap(sourceNode.right + FLOW_EDGE_GAP)
          : snap(Math.max(0, mainTrackX - FLOW_SPLIT_TAIL_LENGTH))
        if (mainTrackX > tailStartX) {
          appendEdge(`M ${tailStartX} ${mainNode.centerY} H ${mainTrackX}`, 'split-tail')
        }
      }
      appendEdge(
        narrowLayout
          ? `M ${mainTrackX} ${mainNode.centerY} H ${branchTrackX} V ${lastBranch.centerY}`
          : `M ${mainTrackX} ${mainNode.centerY} V ${lastBranch.centerY}`,
        'trunk',
      )
      joints.push({ kind: 'main-attach', x: mainTrackX, y: mainNode.centerY })
      for (const branch of branches) {
        joints.push({ kind: 'branch-attach', x: branchTrackX, y: branch.node.centerY })
      }
    }

    if (narrowLayout && mainLane.nodes.length > 1) {
      const trackX = snap(mainLane.nodes[0].left - FLOW_EDGE_GAP - FLOW_CONNECTOR_LENGTH)
      appendEdge(
        `M ${trackX} ${mainLane.nodes[0].centerY} V ${mainLane.nodes.at(-1)!.centerY}`,
        'main-track',
      )
      for (const [laneIndex, branchLane] of laneGeometry.entries()) {
        if (laneIndex === 0 || branchLane.nodes.length < 2) continue
        const branchTrackX = snap(branchLane.nodes[0].left - FLOW_EDGE_GAP - FLOW_CONNECTOR_LENGTH)
        appendEdge(
          `M ${branchTrackX} ${branchLane.nodes[0].centerY} V ${branchLane.nodes.at(-1)!.centerY}`,
          'branch-track',
          false,
          laneIndex,
        )
      }
    }

    svg.dataset.flowJoints = JSON.stringify(joints)
    svg.dataset.flowDeviceScale = String(deviceScale)
  }

  const schedule = () => {
    if (animationFrame) cancelAnimationFrame(animationFrame)
    animationFrame = requestAnimationFrame(render)
  }
  const resizeObserver = new ResizeObserver(schedule)
  resizeObserver.observe(stage)
  resizeObserver.observe(canvas)
  for (const node of canvas.querySelectorAll<HTMLElement>('.markdown-flow-map-node')) {
    resizeObserver.observe(node)
  }
  schedule()

  return () => {
    if (animationFrame) cancelAnimationFrame(animationFrame)
    resizeObserver.disconnect()
  }
}

function setupFlowMap(map: FlowMapDOM, edgeSetups: FlowEdgeSetup[]) {
  let activeCleanup: (() => void) | undefined
  let startFrame = requestAnimationFrame(() => {
    startFrame = 0
    const applySectionLayouts = () => {
      const gutter = map.closest('.cm-editor')?.querySelector<HTMLElement>('.cm-gutters')
      if (gutter) {
        const mapRect = map.getBoundingClientRect()
        const gutterRect = gutter.getBoundingClientRect()
        const gutterBorderWidth = Number.parseFloat(getComputedStyle(gutter).borderRightWidth) || 0
        map.style.setProperty('--flow-gutter-border-width', `${gutterBorderWidth}px`)
        map.style.setProperty(
          '--flow-gutter-width',
          `${Math.max(0, mapRect.left - gutterRect.left - gutterBorderWidth)}px`,
        )
      }
      const roots = Array.from(map.querySelectorAll<HTMLElement>('.markdown-flow-root-label'))
      const rootWidth = Math.ceil(Math.max(0, ...roots.map(root => root.getBoundingClientRect().width)) + 28)
      map.style.setProperty('--flow-root-width', `${rootWidth}px`)
      for (const section of map.querySelectorAll<HTMLElement>('.markdown-flow-section')) {
        const lanes = Array.from(section.querySelectorAll<HTMLElement>('.markdown-flow-lane'))
        if (window.matchMedia('(max-width: 520px)').matches) {
          for (const lane of lanes) lane.style.removeProperty('padding-left')
          continue
        }
        const mainLane = lanes[0]
        const mainNodes = new Map(Array.from(mainLane.querySelectorAll<HTMLElement>('.markdown-flow-map-node'))
          .map(node => [Number(node.dataset.flowStage || 1), node]))
        const mainLaneLeft = mainLane.getBoundingClientRect().left
        for (const branchLane of lanes.slice(1)) {
          const startStage = Number(branchLane.dataset.flowStartStage || 1)
          const target = mainNodes.get(startStage)
          if (!target) continue
          branchLane.style.paddingLeft = `${Math.max(0, target.getBoundingClientRect().left - mainLaneLeft)}px`
        }
      }
      for (const section of map.querySelectorAll<HTMLElement>('.markdown-flow-section')) {
        const sectionRect = section.getBoundingClientRect()
        for (const lineNumber of section.querySelectorAll<HTMLElement>('.markdown-flow-line-number[data-flow-row-target]')) {
          const target = section.querySelector<HTMLElement>(`[data-flow-row-id="${lineNumber.dataset.flowRowTarget}"]`)
          if (!target) continue
          let rects = [target.getBoundingClientRect()]
          if (rects[0].height === 0) {
            rects = Array.from(target.querySelectorAll<HTMLElement>('.markdown-flow-map-node'))
              .map(node => node.getBoundingClientRect())
          }
          if (rects.length === 0) continue
          const top = Math.min(...rects.map(rect => rect.top)) - sectionRect.top
          const bottom = Math.max(...rects.map(rect => rect.bottom)) - sectionRect.top
          lineNumber.style.top = `${top}px`
          lineNumber.style.height = `${bottom - top}px`
        }
      }
    }
    applySectionLayouts()

    const edgeCleanups = edgeSetups.map(setup => setupFlowEdges(
      setup.stage,
      setup.canvas,
      setup.svg,
      setup.edgeGroup,
      setup.markerId,
    ))
    const layoutObserver = new ResizeObserver(() => {
      applySectionLayouts()
    })
    layoutObserver.observe(map)
    activeCleanup = () => {
      edgeCleanups.forEach(cleanup => cleanup())
      layoutObserver.disconnect()
    }
    map.flowCleanup = activeCleanup
  })

  return () => {
    if (startFrame) cancelAnimationFrame(startFrame)
    activeCleanup?.()
  }
}

class FlowMapWidget extends WidgetType {
  private readonly group: FlowGroup

  constructor(group: FlowGroup) {
    super()
    this.group = group
  }

  eq(other: FlowMapWidget) {
    return JSON.stringify(this.group) === JSON.stringify(other.group)
  }

  toDOM(view: EditorView) {
    const map = document.createElement('div') as FlowMapDOM
    map.className = 'markdown-flow-map'
    map.classList.add(this.group.blockParity === 'even' ? 'block-even' : 'block-odd')
    if (this.group.activeBlock) map.classList.add('markdown-flow-map-active')
    map.tabIndex = 0
    map.setAttribute('role', 'button')
    map.setAttribute('aria-label', '流程视图，点击编辑原始文本')
    map.setAttribute('aria-keyshortcuts', 'Enter Space')
    map.title = '点击编辑原始文本'

    const edgeSetups: FlowEdgeSetup[] = []
    const appendBlankRow = (blankLineNumber: number) => {
      const blankRow = document.createElement('div')
      blankRow.className = 'markdown-flow-blank-row'
      blankRow.append(createFlowLineNumber(blankLineNumber))
      map.append(blankRow)
    }
    for (const [sectionIndex, section] of this.group.sections.entries()) {
      for (const blankLineNumber of section.leadingBlankLineNumbers) {
        appendBlankRow(blankLineNumber)
      }
      const sectionElement = document.createElement('section')
      sectionElement.className = 'markdown-flow-section'

      const rootRowId = `section-${sectionIndex}-root`
      const lineNumber = createFlowLineNumber(section.lineNumber, rootRowId)
      sectionElement.append(lineNumber)

      const root = document.createElement('div')
      root.className = 'markdown-flow-root'
      root.dataset.flowRowId = rootRowId
      const rootLabel = document.createElement('span')
      rootLabel.className = 'markdown-flow-root-label'
      rootLabel.textContent = section.root
      root.append(rootLabel)
      sectionElement.append(root)

      const stage = document.createElement('div')
      stage.className = 'markdown-flow-stage'

      const canvas = document.createElement('div')
      canvas.className = 'markdown-flow-canvas'

      const svg = createSvgElement('svg')
      svg.classList.add('markdown-flow-edge-layer')
      svg.setAttribute('aria-hidden', 'true')
      svg.setAttribute('focusable', 'false')

      const markerId = `markdown-flow-arrow-${flowMarkerSequence += 1}-${sectionIndex}`
      const definitions = createSvgElement('defs')
      const marker = createSvgElement('marker')
      marker.id = markerId
      marker.setAttribute('viewBox', '0 -5 10 10')
      marker.setAttribute('refX', '8')
      marker.setAttribute('refY', '0')
      marker.setAttribute('markerWidth', '10')
      marker.setAttribute('markerHeight', '10')
      marker.setAttribute('markerUnits', 'userSpaceOnUse')
      marker.setAttribute('orient', 'auto')
      const arrow = createSvgElement('path')
      arrow.classList.add('markdown-flow-arrow-marker')
      arrow.setAttribute('d', 'M 1 -4 L 8 0 L 1 4')
      marker.append(arrow)
      definitions.append(marker)

      const edgeGroup = createSvgElement('g')
      edgeGroup.classList.add('markdown-flow-edges')
      svg.append(definitions, edgeGroup)

      const lanes = document.createElement('div')
      lanes.className = 'markdown-flow-lanes'
      const pathLineNumbers: HTMLElement[] = []
      const branchStages = new Set(section.paths
        .filter(path => path.depth > 0)
        .map(path => path.startStage))
      for (const [pathIndex, path] of section.paths.entries()) {
        const lane = document.createElement('div')
        lane.className = path.depth > 0
          ? 'markdown-flow-lane markdown-flow-lane-branch'
          : 'markdown-flow-lane markdown-flow-lane-main'
        lane.dataset.flowDepth = String(path.depth)
        lane.dataset.flowStartStage = String(path.startStage)
        const rowId = `section-${sectionIndex}-lane-${pathIndex}`
        lane.dataset.flowRowId = rowId
        if (pathIndex === 0) lane.dataset.flowMain = 'true'
        if (pathIndex > 0) pathLineNumbers.push(createFlowLineNumber(path.lineNumber, rowId))

        for (const [nodeIndex, text] of path.nodes.entries()) {
          const node = document.createElement('div')
          node.className = 'markdown-flow-map-node'
          const stageNumber = path.startStage + nodeIndex
          node.dataset.flowStage = String(stageNumber)
          node.dataset.flowDepth = String(path.depth)
          if (path.depth === 0 && branchStages.has(stageNumber)) {
            node.dataset.flowSplitTarget = 'true'
          }
          node.style.gridColumn = String(stageNumber * 2 - 1)
          node.style.setProperty(
            '--flow-narrow-order',
            String(path.depth > 0
              ? path.startStage * 100 + pathIndex * 10 + nodeIndex + 1
              : stageNumber * 100),
          )
          node.textContent = text
          lane.append(node)
        }
        lanes.append(lane)
      }

      canvas.append(lanes)
      stage.append(canvas, svg)
      sectionElement.append(stage)
      sectionElement.append(...pathLineNumbers)
      map.append(sectionElement)
      edgeSetups.push({ stage, canvas, svg, edgeGroup, markerId })
    }
    const cleanupFlowMap = setupFlowMap(map, edgeSetups)
    map.flowCleanup = cleanupFlowMap

    const edit = () => {
      view.dispatch({
        selection: EditorSelection.cursor(this.group.from),
        effects: setEditingFlow.of({ from: this.group.from, to: this.group.to }),
        scrollIntoView: true,
      })
      view.focus()
    }
    map.addEventListener('click', edit)
    map.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      edit()
    })
    return map
  }

  destroy(dom: HTMLElement) {
    ;(dom as FlowMapDOM).flowCleanup?.()
  }

  ignoreEvent() {
    return false
  }
}

export const flowMapField = StateField.define<FlowMapState>({
  create(state) {
    return {
      editing: null,
      decorations: buildFlowMaps(state, null),
    }
  },
  update(value, transaction) {
    let editing = value.editing
    if (editing && transaction.docChanged) {
      editing = {
        from: transaction.changes.mapPos(editing.from),
        to: transaction.changes.mapPos(editing.to),
      }
    }
    for (const effect of transaction.effects) {
      if (effect.is(setEditingFlow)) editing = effect.value
    }
    if (editing && transaction.selection) {
      const head = transaction.state.selection.main.head
      if (head < editing.from || head > editing.to) editing = null
    }
    return {
      editing,
      decorations: buildFlowMaps(transaction.state, editing),
    }
  },
  provide(field) {
    return EditorView.decorations.from(field, value => value.decorations)
  },
})

function buildFlowMaps(state: EditorState, editing: FlowMapState['editing']) {
  const decorations = flowGroups(state)
    .filter(group => !editing || group.to < editing.from || group.from > editing.to)
    .map(group => Decoration.replace({
      block: true,
      widget: new FlowMapWidget(group),
    }).range(group.from, group.replaceTo))
  return Decoration.set(decorations, true)
}

function flowGroups(state: EditorState) {
  const groups: FlowGroup[] = []
  const selectionHead = state.selection.main.head
  for (const [blockIndex, block] of state.field(blockField).entries()) {
    if (block.language !== 'markdown') continue
    const activeBlock = selectionHead >= block.content.from && selectionHead <= block.content.to
    groups.push(...flowGroupsInBlock(state, block, activeBlock, blockIndex))
  }
  return groups
}

function flowGroupsInBlock(
  state: EditorState,
  block: ScratchBlock,
  activeBlock: boolean,
  blockIndex: number,
) {
  const groups: FlowGroup[] = []
  let current: FlowGroup | null = null
  let currentSection: FlowSection | null = null
  let pendingBlankLineNumbers: number[] = []
  let inFence = false
  let line = state.doc.lineAt(block.content.from)
  const blockStartLine = line.number

  const finish = () => {
    if (current) groups.push(current)
    current = null
    currentSection = null
    pendingBlankLineNumbers = []
  }

  while (line.from <= block.content.to && line.from <= state.doc.length) {
    const text = state.doc.sliceString(
      Math.max(line.from, block.content.from),
      Math.min(line.to, block.content.to),
    )
    if (/^\s*```/.test(text)) {
      finish()
      inFence = !inFence
    } else if (!inFence) {
      const item = parseFlowItem(text)
      if (item) {
      const replaceTo = line.to
        if (!current) {
          current = {
            from: line.from,
            to: line.to,
            replaceTo,
            activeBlock,
            blockParity: blockIndex % 2 === 0 ? 'even' : 'odd',
            sections: [],
          }
        }
        current.to = line.to
        current.replaceTo = replaceTo
        if (item.depth === 0 || !currentSection) {
          currentSection = {
            root: item.nodes[0],
            lineNumber: line.number - blockStartLine + 1,
            leadingBlankLineNumbers: pendingBlankLineNumbers,
            mainArrowColumns: item.arrowColumns,
            paths: item.nodes.length > 1
              ? [{
                  depth: 0,
                  startStage: 1,
                  lineNumber: line.number - blockStartLine + 1,
                  nodes: item.nodes.slice(1),
                }]
              : [],
          }
          pendingBlankLineNumbers = []
          current.sections.push(currentSection)
        } else {
          pendingBlankLineNumbers = []
          currentSection.paths.push({
            depth: item.depth,
            startStage: 1,
            lineNumber: line.number - blockStartLine + 1,
            nodes: item.nodes,
          })
        }
      } else if (current) {
        const continuation = currentSection
          ? parseFlowContinuation(text, currentSection.mainArrowColumns)
          : null
        if (continuation && currentSection) {
          const replaceTo = line.to
          current.to = line.to
          current.replaceTo = replaceTo
          currentSection.paths.push({
            depth: 1,
            startStage: continuation.startStage,
            lineNumber: line.number - blockStartLine + 1,
            nodes: continuation.nodes,
          })
          pendingBlankLineNumbers = []
        } else if (text.trim() === '') {
          pendingBlankLineNumbers.push(line.number - blockStartLine + 1)
        } else if (text.trim() !== '') {
          finish()
        }
      } else if (text.trim() !== '') {
        finish()
      }
    }

    if (line.to >= block.content.to || line.number >= state.doc.lines) break
    line = state.doc.line(line.number + 1)
  }
  finish()
  return groups
}

function parseFlowItem(text: string) {
  const listMatch = text.match(/^(\s*)[-*+]\s+(.+)$/)
  const plainMatch = text.match(/^(\S.*)$/)
  const content = listMatch?.[2] ?? plainMatch?.[1]
  if (!content) return null
  const nodes = splitFlowNodes(content)
  if (nodes.length < 2) return null
  const contentOffset = text.indexOf(content)
  return {
    depth: listMatch ? Math.floor(displayColumn(listMatch[1]) / 2) : 0,
    arrowColumns: flowArrowColumns(text).filter(column => column >= displayColumn(text.slice(0, contentOffset))),
    nodes,
  }
}

function parseFlowContinuation(text: string, parentArrowColumns: number[]) {
  const match = text.match(/^(\s*)->\s+(.+)$/)
  if (!match) return null
  const nodes = splitFlowNodes(match[2])
  if (nodes.length === 0 || parentArrowColumns.length === 0) return null
  const arrowColumn = displayColumn(match[1])
  const nearest = parentArrowColumns
    .map((column, index) => ({ index, distance: Math.abs(column - arrowColumn) }))
    .sort((left, right) => left.distance - right.distance)[0]
  if (!nearest || nearest.distance > 8) return null
  return {
    nodes,
    startStage: nearest.index + 1,
  }
}

function flowArrowColumns(text: string) {
  const columns: number[] = []
  let inCode = false
  for (let index = 0; index < text.length - 1; index += 1) {
    if (text[index] === '`' && text[index - 1] !== '\\') {
      inCode = !inCode
      continue
    }
    if (!inCode && text[index] === '-' && text[index + 1] === '>') {
      columns.push(displayColumn(text.slice(0, index)))
      index += 1
    }
  }
  return columns
}

function displayColumn(text: string) {
  let column = 0
  for (const character of text) {
    if (character === '\t') {
      column += 4 - (column % 4)
    } else if (/\p{Extended_Pictographic}|[\u1100-\u115f\u2329\u232a\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff01-\uff60\uffe0-\uffe6]/u.test(character)) {
      column += 2
    } else if (!/[\u0300-\u036f\ufe00-\ufe0f]/u.test(character)) {
      column += 1
    }
  }
  return column
}

function splitFlowNodes(text: string) {
  const nodes: string[] = []
  let start = 0
  let inCode = false
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '`' && text[index - 1] !== '\\') {
      inCode = !inCode
      continue
    }
    if (!inCode && text.slice(index, index + 4) === ' -> ') {
      nodes.push(text.slice(start, index).trim())
      start = index + 4
      index += 3
    }
  }
  nodes.push(text.slice(start).trim())
  return nodes.filter(Boolean)
}
