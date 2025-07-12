import { catchError, from, map, Observable, of, reduce, shareReplay } from "rxjs";
import { getNativeRegion, GrowthHabit, LocationCode, NativeLocationCode, NativeStatusCode, PlantData, validLocationCodes } from "../models/gov/models";
import fs from 'fs';


export class GovPlantsDataService {

    private readonly _headerMapping: Record<string, keyof PlantData> = {
        "Accepted Symbol": "acceptedSymbol",
        "Synonym Symbol": "synonymSymbol",
        "Symbol": "symbol",
        "Scientific Name": "scientificName",
        "PLANTS Floristic Area": "plantsFloristicArea",
        "State and Province": "stateAndProvince",
        "Category": "category",
        "Family": "family",
        "Duration": "duration",
        "Growth Habit": "growthHabit",
        "Native Status": "nativeLocationCodes",
        "Characteristics Data": "characteristicsData",
        "Active Growth Period": "activeGrowthPeriod",
        "After Harvest Regrowth Rate": "afterHarvestRegrowthRate",
        "Bloat": "bloat",
        "C:N Ratio": "cnRatio",
        "Coppice Potential": "coppicePotential",
        "Fall Conspicuous": "fallConspicuous",
        "Fire Resistance": "fireResistance",
        "Flower Color": "flowerColor",
        "Flower Conspicuous": "flowerConspicuous",
        "Foliage Color": "foliageColor",
        "Foliage Porosity Summer": "foliagePorositySummer",
        "Foliage Porosity Winter": "foliagePorosityWinter",
        "Foliage Texture": "foliageTexture",
        "Fruit Color": "fruitColor",
        "Fruit Conspicuous": "fruitConspicuous",
        "Growth Form": "growthForm",
        "Growth Rate": "growthRate",
        "Height at Base Age, Maximum (feet)": "heightAtBaseAgeMaximumFeet",
        "Height, Mature (feet)": "heightMatureFeet",
        "Known Allelopath": "knownAllelopath",
        "Leaf Retention": "leafRetention",
        "Lifespan": "lifespan",
        "Low Growing Grass": "lowGrowingGrass",
        "Nitrogen Fixation": "nitrogenFixation",
        "Resprout Ability": "resproutAbility",
        "Shape and Orientation": "shapeAndOrientation",
        "Toxicity": "toxicity",
        "Adapted to Coarse Textured Soils": "adaptedToCoarseTexturedSoils",
        "Adapted to Medium Textured Soils": "adaptedToMediumTexturedSoils",
        "Adapted to Fine Textured Soils": "adaptedToFineTexturedSoils",
        "Anaerobic Tolerance": "anaerobicTolerance",
        "CaCO<SUB>3</SUB> Tolerance": "caco3Tolerance",
        "Cold Stratification Required": "coldStratificationRequired",
        "Drought Tolerance": "droughtTolerance",
        "Fertility Requirement": "fertilityRequirement",
        "Fire Tolerance": "fireTolerance",
        "Frost Free Days, Minimum": "frostFreeDaysMinimum",
        "Hedge Tolerance": "hedgeTolerance",
        "Moisture Use": "moistureUse",
        "pH (Minimum)": "phMinimum",
        "pH (Maximum)": "phMaximum",
        "Planting Density per Acre, Minimum": "plantingDensityPerAcreMinimum",
        "Planting Density per Acre, Maximum": "plantingDensityPerAcreMaximum",
        "Precipitation (Minimum)": "precipitationMinimum",
        "Precipitation (Maximum)": "precipitationMaximum",
        "Root Depth, Minimum (inches)": "rootDepthMinimumInches",
        "Salinity Tolerance": "salinityTolerance",
        "Shade Tolerance": "shadeTolerance",
        "Temperature, Minimum (°F)": "temperatureMinimumF",
        "Bloom Period": "bloomPeriod",
        "Commercial Availability": "commercialAvailability",
        "Fruit/Seed Abundance": "fruitSeedAbundance",
        "Fruit/Seed Period Begin": "fruitSeedPeriodBegin",
        "Fruit/Seed Period End": "fruitSeedPeriodEnd",
        "Fruit/Seed Persistence": "fruitSeedPersistence",
        "Propogated by Bare Root": "propogatedByBareRoot",
        "Propogated by Bulbs": "propogatedByBulbs",
        "Propogated by Container": "propogatedByContainer",
        "Propogated by Corms": "propogatedByCorms",
        "Propogated by Cuttings": "propogatedByCuttings",
        "Propogated by Seed": "propogatedBySeed",
        "Propogated by Sod": "propogatedBySod",
        "Propogated by Sprigs": "propogatedBySprigs",
        "Propogated by Tubers": "propogatedByTubers",
        "Seeds per Pound": "seedsPerPound",
        "Seed Spread Rate": "seedSpreadRate",
        "Seedling Vigor": "seedlingVigor",
        "Small Grain": "smallGrain",
        "Vegetative Spread Rate": "vegetativeSpreadRate",
        "Berry/Nut/Seed Product": "berryNutSeedProduct",
        "Christmas Tree Product": "christmasTreeProduct",
        "Fodder Product": "fodderProduct",
        "Fuelwood Product": "fuelwoodProduct",
        "Lumber Product": "lumberProduct",
        "Naval Store Product": "navalStoreProduct",
        "Nursery Stock Product": "nurseryStockProduct",
        "Palatable Browse Animal": "palatableBrowseAnimal",
        "Palatable Graze Animal": "palatableGrazeAnimal",
        "Palatable Human": "palatableHuman",
        "Post Product": "postProduct",
        "Protein Potential": "proteinPotential",
        "Pulpwood Product": "pulpwoodProduct",
        "Veneer Product": "veneerProduct"
    };

    private readonly dataUrl = 'assets/PLANTS_Characteristics_Plus_Data.csv';
    private static readonly MINIMUM_SPECIES_NAME_WORDS = 2;

    public constructor() { }


    public loadAllDefiniteNativePlantData(): Observable<ReadonlyArray<Readonly<PlantData>>> {
        return this.getPlantDataFromCSV().pipe(
            // Filters out non species listings
            map((plantData: Readonly<PlantData>[]) => {
                const speciesGroups = new Map<string, PlantData[]>();
                const result: Readonly<PlantData>[] = [];

                // Group by base species name
                plantData.forEach(plant => {
                    const words = plant.scientificName.split(/\s+/);
                    if (words.length >= GovPlantsDataService.MINIMUM_SPECIES_NAME_WORDS) {
                        const baseSpecies = `${words[0]} ${words[1]}`;
                        if (!speciesGroups.has(baseSpecies)) {
                            speciesGroups.set(baseSpecies, []);
                        }
                        speciesGroups.get(baseSpecies)!.push(plant);
                    }
                });

                // For each species group, decide what to keep
                speciesGroups.forEach(group => {
                    const subspeciesEntries = group.filter(plant => /\b(subsp\.|var\.|f\.)\b/.test(plant.scientificName));

                    if (subspeciesEntries.length > 0) {
                        // Keep subspecies, exclude base species
                        result.push(...subspeciesEntries);
                    } else {
                        // No subspecies exist, keep everything in the group
                        result.push(...group);
                    }
                });

                return result;
            }),
            map((plantData: Readonly<PlantData>[]) => plantData.filter(plantDatum => plantDatum.nativeLocationCodes.size > 0)),
            // Return as a deeply immutable array
            map((plantData: Readonly<PlantData>[]) => Object.freeze(plantData)),
            shareReplay(1),
            catchError(error => {
                console.error('Error loading definite native plant data:', error);
                return of([] as ReadonlyArray<PlantData>);
            }));
    }

    public getAllNativePlantIds(): Observable<Readonly<string[]>> {
        return this.loadAllDefiniteNativePlantData().pipe(map((plantData: ReadonlyArray<Readonly<PlantData>>) => plantData.map(x => x.acceptedSymbol)));
    }

    private getPlantDataFromCSV(): Observable<Readonly<PlantData>[]> {
        return this.getRecordsFromCSV().pipe(
            // Convert each row to PlantData object and filter for native plants
            map(csvData => csvData.map((row: Record<string, string>) => (this.convertCsvRowToPlantData(row)) as Readonly<PlantData>)));
    }

    /**
     * HACK use this for testing to see if the native ranges are correct without parsing into plant data / aka native plant range conversion
     * @returns 
     */
    private getRecordsFromCSV(): Observable<Record<string, string>[]> {
        const readStreamObservable = from(fs.createReadStream(this.dataUrl, { encoding: 'utf8' }));
        return readStreamObservable.pipe(
            // The 'data' events from a ReadStream emit chunks (which are often Buffers).
            // The 'reduce' operator will collect these chunks and combine them.
            reduce((acc, chunk) => acc + chunk, ''),
            // Ensure the final accumulated value (which will be a string) is correctly typed
            map(data => data.toString()),
        map((csvText)=> this.parseCsv(csvText))); 
    }

    private parseCsv(csvText: string): Record<string, string>[] {
        // Simple CSV parser (you might want to use a library like papaparse in a real app)
        const lines = csvText.split('\n');
        const headers = lines[0].split(',').map(header => header.trim());

        return lines.slice(1)
            .filter(line => line.trim() !== '') // Skip empty lines
            .map(line => {
                const values = this.parseCsvLine(line);
                const row: Record<string, string> = {};

                headers.forEach((header, index) => {
                    row[header] = values[index] || '';
                });

                return row;
            });
    }


    // Helper function to parse distribution strings from PLANTS database
    private parseDistributionString(distribution: string | undefined | null): ReadonlyArray<LocationCode> {
        // Handle undefined, null, or empty distribution strings
        if (!distribution) {
            return Object.freeze([]);
        }

        // Remove country prefixes and parentheses, then split by comma
        // Handles optional + infront of USA+() combined with possible USA() in same line because USA+([...PR, VI]) 
        const cleaned = distribution
            .replace(/USA\+?\s?\(([^)]+)\)/g, '$1')
            .replace(/CAN\+?\s?\(([^)]+)\)/g, '$1')
            .replace(/\s/g, '');

        return Object.freeze(cleaned.split(',').filter((code): code is LocationCode => validLocationCodes.has(code as LocationCode)));
    }

    // Helper to handle quoted values and commas within fields
    private parseCsvLine(line: string): string[] {
        const result: string[] = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];

            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                result.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }

        // Add the last field
        result.push(current.trim());
        return result;
    }

    private parseGrowthHabit(habitCsvValue: string): ReadonlyArray<GrowthHabit> {
        return Object.freeze(habitCsvValue.split(',').map(v => v.trim() as GrowthHabit));
    }


    /**
     * Converts the csv value for nativeStatus into the indexed array searchable for locationCodes
     * @param csvValue 
     * @returns 
     */
    private parseNativeStatus(csvValue: string, stateAndProvinceValues: ReadonlyArray<LocationCode>): Set<LocationCode> {
        if (!csvValue) return new Set();

        const regex = /([A-Z0-9]+)\(([A-Z?]+)\)/g;
        let result: LocationCode[] = [];
        let match;

        // Parses the csv row for ${LOCATION}(${STATUS}) on repeat until the end of the value
        // Compiles that into properties for each applicable nativity status with regions mapped in

        while ((match = regex.exec(csvValue)) !== null) {
            const [matchedGroup, locationString, statusCode] = match;
            const status = statusCode as NativeStatusCode;
            if (status !== 'N')
                continue;
            let property: LocationCode[] = result
            const location = locationString as NativeLocationCode;


            // TODO the distributionString can contain both CA(N)NA(N)
            // e.g. ACAL17,,ACAL17,Achillea alpina,NA (CAN),"CAN(AB, BC, MB, NT, ON, QC, SK, YT)",Dicot,Asteraceae,Perennial,Forb/herb,CAN(N)NA(N),No,...,
            // In this case, only canada and those regions within it are native, but NA(N) is still labeled for some reason?
            // AKA more are labeled native to other parts of americas than they should and it should not include the extra regions either like spm and shit

            // Handle continental native status NA(N) - native to entire continent
            if (location === 'NA' && matchedGroup.length == csvValue.length) {
                // Add all North American states/provinces
                return validLocationCodes; // HACK all NA location codes including islands
            } else if (location === 'NA') {
                // TODO possibly have to use floristic area mapping not sure
                continue;
            }

            if (!property)
                property = [];

            // Turn location aka broad region => state && territories aka LocationCode
            stateAndProvinceValues.forEach((province: LocationCode) => {
                const nativeRegion: NativeLocationCode[] | undefined = getNativeRegion(province);
                if (nativeRegion && nativeRegion.some(x => x == location))
                    property.push(province);
            });

            result.push(...property);
        }

        return new Set(result);
    }

    private convertCsvRowToPlantData(csvRow: Record<string, string>): Readonly<PlantData> {
        const result: Record<string, any> = {};
        const rowKeys = Object.keys(csvRow);
        const distributionColumnName = rowKeys.find(key =>
            key.toLowerCase().replace(/\s+/g, ' ').trim() === 'state and province'
        );
        const nativeStatusColumnName = rowKeys.find(key =>
            key.toLowerCase().replace(/\s+/g, ' ').trim() === 'native status'
        );

        const stateAndProvinceValues: ReadonlyArray<LocationCode> = distributionColumnName ? this.parseDistributionString(csvRow[distributionColumnName]) : Object.freeze([]);
        const nativeStatusValues: Set<LocationCode> = nativeStatusColumnName ? this.parseNativeStatus(csvRow[nativeStatusColumnName], stateAndProvinceValues) : new Set();

        // Map each property using our predefined mapping
        Object.entries(csvRow).forEach(([key, value]) => {
            if (key in this._headerMapping) {
                const camelKey = this._headerMapping[key] as keyof PlantData;

                if (camelKey === 'nativeLocationCodes') {
                    result[camelKey] = nativeStatusValues;
                }
                else if (camelKey === 'stateAndProvince') {
                    // Use the pre-parsed distribution values instead of re-parsing
                    result[camelKey] = stateAndProvinceValues;
                }
                else if (camelKey === 'growthHabit') {
                    result[camelKey] = this.parseGrowthHabit(value);
                }
                // Handle different data types
                else if (value === 'true' || value === 'yes' || value === 'y') {
                    result[camelKey] = true;
                } else if (value === 'false' || value === 'no' || value === 'n') {
                    result[camelKey] = false;
                } else if (!isNaN(Number(value)) && value !== '') {
                    result[camelKey] = Number(value);
                } else if (value.includes(',')) {
                    // Handle array values (comma-separated strings)
                    // Make the array immutable using Object.freeze
                    result[camelKey] = Object.freeze(value.split(',').map(v => v.trim()));
                } else {
                    result[camelKey] = value;
                }
            }
        });
        // Return as a deeply immutable object
        return Object.freeze(result) as PlantData;
    }
}