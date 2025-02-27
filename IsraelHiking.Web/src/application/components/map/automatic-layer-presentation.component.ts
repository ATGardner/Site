import { Component, Input, OnInit, OnChanges, SimpleChanges, OnDestroy } from "@angular/core";
import { MapComponent } from "@maplibre/ngx-maplibre-gl";
import {
    StyleSpecification,
    RasterSourceSpecification,
    RasterLayerSpecification,
    SourceSpecification,
    LayerSpecification
} from "maplibre-gl";
import { Observable, Subscription } from "rxjs";
import { NgRedux, select } from "@angular-redux2/store";

import { BaseMapComponent } from "../base-map.component";
import { ResourcesService } from "../../services/resources.service";
import { FileService } from "../../services/file.service";
import { ConnectionService } from "../../services/connection.service";
import { MapService } from "../../services/map.service";
import type { ApplicationState, EditableLayer, Language } from "../../models/models";

@Component({
    selector: "auto-layer",
    templateUrl: "./automatic-layer-presentation.component.html"
})
export class AutomaticLayerPresentationComponent extends BaseMapComponent implements OnInit, OnChanges, OnDestroy {
    private static indexNumber = 0;

    private static readonly ATTRIBUTION = "<a href='https://github.com/IsraelHikingMap/Site/wiki/Attribution' target='_blank'>" +
        "Click me to see attribution</a>";

    @Input()
    public visible: boolean;
    @Input()
    public before: string;
    @Input()
    public isBaselayer: boolean;
    @Input()
    public layerData: EditableLayer;
    @Input()
    public isMainMap: boolean;

    private rasterSourceId: string;
    private rasterLayerId: string;
    private sourceAdded: boolean;
    private subscriptions: Subscription[];
    private jsonSourcesIds: string[];
    private jsonLayersIds: string[];
    private hasInternetAccess: boolean;
    private mapLoadedPromise: Promise<void>;

    @select((state: ApplicationState) => state.configuration.language)
    private language$: Observable<Language>;

    constructor(resources: ResourcesService,
                private readonly mapComponent: MapComponent,
                private readonly fileService: FileService,
                private readonly connectionSerive: ConnectionService,
                private readonly mapService: MapService,
                private readonly ngRedux: NgRedux<ApplicationState>) {
        super(resources);
        let layerIndex = AutomaticLayerPresentationComponent.indexNumber++;
        this.rasterLayerId = `raster-layer-${layerIndex}`;
        this.rasterSourceId = `raster-source-${layerIndex}`;
        this.sourceAdded = false;
        this.hasInternetAccess = true;
        this.jsonSourcesIds = [];
        this.jsonLayersIds = [];
        this.subscriptions = [];
        this.mapLoadedPromise = new Promise((resolve, _) => {
            this.subscriptions.push(this.mapComponent.mapLoad.subscribe(() => {
                resolve();
            }));
        });
    }

    public async ngOnInit() {
        await (this.isMainMap ? this.mapService.initializationPromise : this.mapLoadedPromise);
        await this.createLayer();
        this.sourceAdded = true;
        this.subscriptions.push(this.language$.subscribe(async () => {
            if (this.sourceAdded) {
                this.removeLayer(this.layerData.address);
                await this.createLayer();
            }
        }));
        this.subscriptions.push(this.connectionSerive.monitor(true).subscribe(async (state) => {
            if (state.hasInternetAccess === this.hasInternetAccess) {
                return;
            }
            this.hasInternetAccess = state.hasInternetAccess;
            if (this.ngRedux.getState().offlineState.lastModifiedDate == null || this.layerData.isOfflineAvailable === false) {
                return;
            }
            if (this.layerData.isOfflineOn === true) {
                return;
            }
            if (this.sourceAdded) {
                this.removeLayer(this.layerData.address);
                await this.createLayer();
            }
        }));
    }

    public ngOnDestroy() {
        for (let subscription of this.subscriptions) {
            subscription.unsubscribe();
        }
        if (this.sourceAdded) {
            this.removeLayer(this.layerData.address);
            this.sourceAdded = false;
        }
    }

    async ngOnChanges(changes: SimpleChanges) {
        if (this.sourceAdded) {
            let addressToRemove = changes.layerData ? changes.layerData.previousValue.address : this.layerData.address;
            this.removeLayer(addressToRemove);
            await this.createLayer();
        }
    }

    private isRaster(address: string) {
        return !address.endsWith("json");
    }

    private createRasterLayer() {
        let address = this.layerData.address;
        let scheme = "xyz";
        if (this.layerData.address.match(/\/MapServer(\/\d+)?$/i) != null) {
            address += "/export?dpi=96&transparent=true&format=png32&bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&f=image";
        } else if (this.layerData.address.indexOf("{-y}") !== -1) {
            address = address.replace("{-y}", "{y}");
            scheme = "tms";
        }
        let source = {
            type: "raster",
            tiles: [address],
            minzoom: Math.max(this.layerData.minZoom - 1, 0),
            maxzoom: this.layerData.maxZoom,
            scheme,
            tileSize: 256,
            attribution: AutomaticLayerPresentationComponent.ATTRIBUTION
        } as RasterSourceSpecification;
        this.mapComponent.mapInstance.addSource(this.rasterSourceId, source);
        let layer = {
            id: this.rasterLayerId,
            type: "raster",
            source: this.rasterSourceId,
            layout: {
                visibility: (this.visible ? "visible" : "none") as "visible" | "none"
            },
            paint: {
                "raster-opacity": this.layerData.opacity || 1.0
            }
        } as RasterLayerSpecification;
        this.mapComponent.mapInstance.addLayer(layer, this.before);
    }

    private removeRasterLayer() {
        this.mapComponent.mapInstance.removeLayer(this.rasterLayerId);
        this.mapComponent.mapInstance.removeSource(this.rasterSourceId);
    }

    private async createJsonLayer() {
        let response = await this.fileService
            .getStyleJsonContent(this.layerData.address, this.layerData.isOfflineOn || !this.hasInternetAccess);
        let language = this.resources.getCurrentLanguageCodeSimplified();
        let styleJson = JSON.parse(JSON.stringify(response).replace(/name:he/g, `name:${language}`)) as StyleSpecification;
        this.updateSourcesAndLayers(styleJson.sources, styleJson.layers);
    }

    private updateSourcesAndLayers(sources: {[_: string]: SourceSpecification}, layers: LayerSpecification[]) {
        let attributiuonUpdated = false;
        for (let sourceKey of Object.keys(sources)) {
            if (sources.hasOwnProperty(sourceKey) && this.visible) {
                let source = sources[sourceKey];
                if (!this.isBaselayer) {
                    sourceKey = this.layerData.key + "_" + sourceKey;
                }
                if (source.type === "vector") {
                    source.attribution = attributiuonUpdated === false ? AutomaticLayerPresentationComponent.ATTRIBUTION : "";
                    attributiuonUpdated = true;
                }

                this.mapComponent.mapInstance.addSource(sourceKey, source);
                this.jsonSourcesIds.push(sourceKey);
            }
        }
        for (let layer of layers) {
            if (!this.visible || (!this.isBaselayer && layer.metadata && !(layer.metadata as any)["IHM:overlay"])) {
                continue;
            }
            if (!this.isBaselayer) {
                layer.id = this.layerData.key + "_" + layer.id;
                (layer as any).source = this.layerData.key + "_" + (layer as any).source;
            }
            this.mapComponent.mapInstance.addLayer(layer, this.before);
            this.jsonLayersIds.push(layer.id);
        }
    }

    private removeJsonLayer() {
        for (let layerId of this.jsonLayersIds) {
            this.mapComponent.mapInstance.removeLayer(layerId);
        }
        this.jsonLayersIds = [];
        for (let sourceId of this.jsonSourcesIds) {
            this.mapComponent.mapInstance.removeSource(sourceId);
        }
        this.jsonSourcesIds = [];
    }

    private async createLayer() {
        if (this.isRaster(this.layerData.address)) {
            this.createRasterLayer();
        } else {
            await this.createJsonLayer();
        }
        if (this.isBaselayer) {
            this.mapComponent.mapInstance.setMinZoom(Math.max(this.layerData.minZoom - 1, 0));
        }
    }

    private removeLayer(address: string) {
        if (this.isRaster(address)) {
            this.removeRasterLayer();
        } else {
            this.removeJsonLayer();
        }
    }
}
