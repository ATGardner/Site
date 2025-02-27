import { Injectable } from "@angular/core";
import { StyleSpecification } from "maplibre-gl";

import { FileService } from "./file.service";

@Injectable()
export class DefaultStyleService {
    public style: StyleSpecification;

    constructor(private readonly fileService: FileService) {
        this.style = {
            version: 8,
            sources: {},
            layers: [],
            glyphs: this.fileService.getFullFilePath("fonts/glyphs/{fontstack}/{range}.pbf"),
            sprite: this.fileService.getFullFilePath("content/sprite/sprite")
        };
    }
}
