import { Events } from '../../enums';
import { getEnabledElement, utilities as csUtils } from '@cornerstonejs/core';
import type { Types } from '@cornerstonejs/core';

import { AnnotationTool } from '../base';
import {
  addAnnotation,
  getAnnotations,
  removeAnnotation,
} from '../../stateManagement/annotation/annotationState';

import {
  triggerAnnotationCompleted,
  triggerAnnotationModified,
} from '../../stateManagement/annotation/helpers/state';
import {
  drawArrow as drawArrowSvg,
  drawHandles as drawHandlesSvg,
} from '../../drawingSvg';
import { state } from '../../store/state';
import { getViewportIdsWithToolToRender } from '../../utilities/viewportFilters';
import triggerAnnotationRenderForViewportIds from '../../utilities/triggerAnnotationRenderForViewportIds';

import {
  resetElementCursor,
  hideElementCursor,
} from '../../cursors/elementCursor';

import type {
  EventTypes,
  PublicToolProps,
  ToolProps,
  SVGDrawingHelper,
  Annotation,
} from '../../types';
import type { KeyImageAnnotation } from '../../types/ToolSpecificAnnotationTypes';
import type { StyleSpecifier } from '../../types/AnnotationStyle';

type Point2 = Types.Point2;

class KeyImageTool extends AnnotationTool {
  static toolName = 'KeyImage';

  /** A mix in data element to set the series level annotation */
  public static dataSeries = {
    data: {
      seriesLevel: true,
    },
  };

  /** A mix in data element to set the point to be true.  That renders as a point
   * on the image rather than just selecting the image itself
   */
  public static dataPoint = {
    data: {
      isPoint: true,
    },
  };

  _throttledCalculateCachedStats: Function;

  constructor(
    toolProps: PublicToolProps = {},
    defaultToolProps: ToolProps = {
      supportedInteractionTypes: ['Mouse', 'Touch'],
      configuration: {
        getTextCallback,
        changeTextCallback,
        canvasPosition: [10, 10],
        canvasSize: 10,
        handleRadius: '6',
        /** If true, this selects the entire series/display set */
        seriesLevel: false,
        /** If true, shows the point selected */
        isPoint: false,
      },
    }
  ) {
    super(toolProps, defaultToolProps);
  }

  /**
   * Based on the current position of the mouse and the current imageId to create
   * a Length Annotation and stores it in the annotationManager
   *
   * @param evt -  EventTypes.NormalizedMouseEventType
   * @returns The annotation object.
   *
   */
  addNewAnnotation = (evt: EventTypes.InteractionEventType) => {
    const eventDetail = evt.detail;
    const { element, currentPoints } = eventDetail;
    const enabledElement = getEnabledElement(element);
    const { viewport } = enabledElement;
    const worldPos = currentPoints.world;

    const annotation = (<typeof KeyImageTool>(
      this.constructor
    )).createAnnotationForViewport(viewport, {
      data: {
        handles: { points: [<Types.Point3>[...worldPos]] },
        seriesLevel: this.configuration.seriesLevel,
        isPoint: this.configuration.isPoint,
      },
    });

    addAnnotation(annotation, element);

    const viewportIdsToRender = getViewportIdsWithToolToRender(
      element,
      this.getToolName()
    );

    evt.preventDefault();

    triggerAnnotationRenderForViewportIds(viewportIdsToRender);

    this.configuration.getTextCallback((text) => {
      if (!text) {
        removeAnnotation(annotation.annotationUID);
        triggerAnnotationRenderForViewportIds(viewportIdsToRender);
        this.isDrawing = false;
        return;
      }
      annotation.data.text = text;

      triggerAnnotationCompleted(annotation);

      triggerAnnotationRenderForViewportIds(viewportIdsToRender);
    });

    this.createMemo(element, annotation, { newAnnotation: true });

    return annotation;
  };

  /**
   * It returns if the canvas point is near the provided length annotation in the provided
   * element or not. A proximity is passed to the function to determine the
   * proximity of the point to the annotation in number of pixels.
   *
   * @param element - HTML Element
   * @param annotation - Annotation
   * @param canvasCoords - Canvas coordinates
   * @param proximity - Proximity to tool to consider
   * @returns Boolean, whether the canvas point is near tool
   */
  isPointNearTool = (
    element: HTMLDivElement,
    annotation: Annotation,
    canvasCoords: Types.Point2,
    proximity: number
  ): boolean => {
    const enabledElement = getEnabledElement(element);
    const { viewport } = enabledElement;
    const { data } = annotation;

    if (!data?.isPoint) {
      return false;
    }

    const { canvasPosition, canvasSize } = this.configuration;
    if (!canvasPosition?.length) {
      return false;
    }
    if (
      Math.abs(canvasCoords[0] - canvasPosition[0] + canvasSize / 2) <=
        canvasSize / 2 &&
      Math.abs(canvasCoords[1] - canvasPosition[1] + canvasSize / 2) <=
        canvasSize / 2
    ) {
      return true;
    }
    return false;
  };

  toolSelectedCallback = (
    evt: EventTypes.InteractionEventType,
    annotation: Annotation
  ): void => {
    annotation.highlighted = true;

    evt.preventDefault();
  };

  handleSelectedCallback(
    evt: EventTypes.InteractionEventType,
    annotation: KeyImageAnnotation
  ): void {
    const eventDetail = evt.detail;
    const { element } = eventDetail;

    annotation.highlighted = true;

    const viewportIdsToRender = getViewportIdsWithToolToRender(
      element,
      this.getToolName()
    );

    // Find viewports to render on drag.

    this.editData = {
      //handle, // This would be useful for other tools with more than one handle
      annotation,
      viewportIdsToRender,
    };
    this._activateModify(element);

    hideElementCursor(element);

    triggerAnnotationRenderForViewportIds(viewportIdsToRender);

    evt.preventDefault();
  }

  public static setPoint(
    annotation,
    isPoint: boolean = !annotation.data.isPoint,
    element?
  ) {
    annotation.data.isPoint = isPoint;
    triggerAnnotationModified(annotation, element);
  }

  _endCallback = (evt: EventTypes.InteractionEventType): void => {
    const eventDetail = evt.detail;
    const { element } = eventDetail;

    const { annotation, viewportIdsToRender, newAnnotation } = this.editData;

    const { viewportId, renderingEngine } = getEnabledElement(element);
    this.eventDispatchDetail = {
      viewportId,
      renderingEngineId: renderingEngine.id,
    };

    this._deactivateModify(element);

    resetElementCursor(element);

    if (newAnnotation) {
      this.createMemo(element, annotation, { newAnnotation });
    }

    this.editData = null;
    this.isDrawing = false;
    this.doneEditMemo();

    if (
      this.isHandleOutsideImage &&
      this.configuration.preventHandleOutsideImage
    ) {
      removeAnnotation(annotation.annotationUID);
    }

    triggerAnnotationRenderForViewportIds(viewportIdsToRender);

    if (newAnnotation) {
      triggerAnnotationCompleted(annotation);
    }
  };

  doubleClickCallback = (evt: EventTypes.TouchTapEventType): void => {
    const eventDetail = evt.detail;
    const { element } = eventDetail;
    let annotations = getAnnotations(this.getToolName(), element);

    annotations = this.filterInteractableAnnotationsForElement(
      element,
      annotations
    );

    if (!annotations?.length) {
      return;
    }

    const clickedAnnotation = annotations.find((annotation) =>
      this.isPointNearTool(
        element,
        annotation as Annotation,
        eventDetail.currentPoints.canvas,
        6 // Todo: get from configuration
      )
    );

    if (!clickedAnnotation) {
      return;
    }

    const annotation = clickedAnnotation as Annotation;
    this.createMemo(element, annotation);
    this.configuration.changeTextCallback(
      clickedAnnotation,
      evt.detail,
      this._doneChangingTextCallback.bind(this, element, annotation)
    );

    this.isDrawing = false;

    this.doneEditMemo();
    // This double click was handled and the dialogue was displayed.
    // No need for any other listener to handle it too - stopImmediatePropagation
    // helps ensure this primarily so that no other listeners on the target element
    // get called.
    evt.stopImmediatePropagation();
    evt.preventDefault();
  };

  _doneChangingTextCallback(element, annotation, updatedText): void {
    annotation.data.text = updatedText;

    const viewportIdsToRender = getViewportIdsWithToolToRender(
      element,
      this.getToolName()
    );
    triggerAnnotationRenderForViewportIds(viewportIdsToRender);

    // Dispatching annotation modified
    triggerAnnotationModified(annotation, element);
  }

  _dragCallback = (evt) => {
    this.isDrawing = true;
    const eventDetail = evt.detail;
    const { currentPoints, element } = eventDetail;
    const worldPos = currentPoints.world;

    const { annotation, viewportIdsToRender, newAnnotation } = this.editData;
    const { data } = annotation;

    this.createMemo(element, annotation, { newAnnotation });

    data.handles.points[0] = [...worldPos] as Types.Point3;
    annotation.invalidated = true;

    triggerAnnotationRenderForViewportIds(viewportIdsToRender);
  };

  public cancel(element: HTMLDivElement) {
    // If it is mid-draw or mid-modify
    if (this.isDrawing) {
      this.isDrawing = false;
      this._deactivateModify(element);
      resetElementCursor(element);

      const { annotation, viewportIdsToRender, newAnnotation } = this.editData;
      const { data } = annotation;

      annotation.highlighted = false;
      data.handles.activeHandleIndex = null;

      triggerAnnotationRenderForViewportIds(viewportIdsToRender);

      if (newAnnotation) {
        triggerAnnotationCompleted(annotation);
      }

      this.editData = null;
      return annotation.annotationUID;
    }
  }

  _activateModify = (element) => {
    state.isInteractingWithTool = true;

    element.addEventListener(Events.MOUSE_UP, this._endCallback);
    element.addEventListener(Events.MOUSE_DRAG, this._dragCallback);
    element.addEventListener(Events.MOUSE_CLICK, this._endCallback);

    element.addEventListener(Events.TOUCH_END, this._endCallback);
    element.addEventListener(Events.TOUCH_DRAG, this._dragCallback);
    element.addEventListener(Events.TOUCH_TAP, this._endCallback);
  };

  _deactivateModify = (element) => {
    state.isInteractingWithTool = false;

    element.removeEventListener(Events.MOUSE_UP, this._endCallback);
    element.removeEventListener(Events.MOUSE_DRAG, this._dragCallback);
    element.removeEventListener(Events.MOUSE_CLICK, this._endCallback);

    element.removeEventListener(Events.TOUCH_END, this._endCallback);
    element.removeEventListener(Events.TOUCH_DRAG, this._dragCallback);
    element.removeEventListener(Events.TOUCH_TAP, this._endCallback);
  };

  /**
   * it is used to draw the length annotation in each
   * request animation frame. It calculates the updated cached statistics if
   * data is invalidated and cache it.
   *
   * @param enabledElement - The Cornerstone's enabledElement.
   * @param svgDrawingHelper - The svgDrawingHelper providing the context for drawing.
   */
  renderAnnotation = (
    enabledElement: Types.IEnabledElement,
    svgDrawingHelper: SVGDrawingHelper
  ): boolean => {
    let renderStatus = false;
    const { viewport } = enabledElement;
    const { element } = viewport;

    let annotations = getAnnotations(this.getToolName(), element);

    // Todo: We don't need this anymore, filtering happens in triggerAnnotationRender
    if (!annotations?.length) {
      return renderStatus;
    }

    annotations = this.filterInteractableAnnotationsForElement(
      element,
      annotations
    );

    if (!annotations?.length) {
      return renderStatus;
    }

    const styleSpecifier: StyleSpecifier = {
      toolGroupId: this.toolGroupId,
      toolName: this.getToolName(),
      viewportId: enabledElement.viewport.id,
    };

    // Draw SVG
    for (let i = 0; i < annotations.length; i++) {
      const annotation = annotations[i];
      const { annotationUID, data } = annotation;

      styleSpecifier.annotationUID = annotationUID;

      const { color, lineWidth } = this.getAnnotationStyle({
        annotation,
        styleSpecifier,
      });

      const { canvasPosition, canvasSize } = this.configuration;
      const arrowUID = '1';
      if (data?.isPoint) {
        const point = data.handles.points[0];
        const canvasCoordinates = viewport.worldToCanvas(point);

        drawHandlesSvg(
          svgDrawingHelper,
          annotationUID,
          arrowUID,
          [canvasCoordinates],
          {
            color,
            lineWidth,
            handleRadius: this.configuration.handleRadius,
          }
        );
      } else if (canvasPosition?.length) {
        drawArrowSvg(
          svgDrawingHelper,
          annotationUID,
          arrowUID,
          canvasPosition.map((it) => it + canvasSize) as Point2,
          canvasPosition as Point2,
          {
            color,
            width: 1,
          }
        );
      }

      renderStatus = true;

      // If rendering engine has been destroyed while rendering
      if (!viewport.getRenderingEngine()) {
        console.warn('Rendering Engine has been destroyed');
        return renderStatus;
      }
    }

    return renderStatus;
  };

  _isInsideVolume(index1, index2, dimensions) {
    return (
      csUtils.indexWithinDimensions(index1, dimensions) &&
      csUtils.indexWithinDimensions(index2, dimensions)
    );
  }
}

function getTextCallback(doneChangingTextCallback) {
  return doneChangingTextCallback(prompt('Enter your annotation:'));
}

function changeTextCallback(data, eventData, doneChangingTextCallback) {
  return doneChangingTextCallback(prompt('Enter your annotation:'));
}

export default KeyImageTool;
