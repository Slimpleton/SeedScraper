import puppeteer, { Browser, Page } from 'puppeteer';
import { catchError, concatAll, debounceTime, defer, delay, forkJoin, from, interval, map, mergeAll, Observable, of, shareReplay, Subject, switchMap, takeUntil, tap, withLatestFrom, zip } from 'rxjs';
import { GovPlantsDataService } from './PLANTS_data.service';
import fs from 'fs';

export class PlantsWebScraperService {
  private readonly _CSVName: string = 'PLANTS_EXTRA_DATA.csv';
  private readonly _CSVHeaders: string[] = ['Accepted Symbol', 'Counties', 'Common Name'];
  private readonly _PlantProfileHeaderName: string = 'plant-profile-header';
  public readonly usdaGovPlantProfileUrl: string = 'https://plants.usda.gov/plant-profile/';

  private readonly _ngDestroy$: Subject<void> = new Subject<void>();
  // TODO this is not accepted it breaks for some reason?? not changing to observable correctly prob
  private readonly _browserRequest$: Observable<Browser> = from(puppeteer.launch({
    headless: false,
    slowMo: 250,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  })).pipe(
    shareReplay(1),
    takeUntil(this._ngDestroy$));

  // public get newPage$(): Observable<Page> {
  //   return this._browserRequest$.pipe(
  //     switchMap((browser: Browser) => from(browser.newPage())),
  //   );
  // }

  constructor(private readonly _plantDataService: GovPlantsDataService) { }

  public write(): Observable<any> {
    const csvPath = './assets/' + this._CSVName;
    const escapedHeaders = this._CSVHeaders.map((x: string) => '"' + x + '"').join(',');
    const allIdsCSVPath = './assets/allIds.csv';

    return this._plantDataService.getAllNativePlantIds().pipe(
      switchMap((ids: ReadonlyArray<string>) => {
        // If file does not exist, create the file with headers
        if (fs.existsSync(csvPath))
          fs.unlinkSync(csvPath);
        fs.writeFileSync(csvPath, escapedHeaders);

        if (fs.existsSync(allIdsCSVPath))
          fs.unlinkSync(allIdsCSVPath);
        fs.writeFileSync(allIdsCSVPath, ids.join(','));

        return forkJoin([of(ids), this._browserRequest$]);
      }),
      switchMap(([ids, browser]: [ReadonlyArray<string>, Browser]) =>
        zip(
          from(ids),
          interval(1000)
        ).pipe(
          switchMap(([id, _]) => this.writeSpeciesRxjs(browser, id)))
      ),
      catchError((err: any) => {
        console.error(err);
        return of();
      }),
      takeUntil(this._ngDestroy$)
    );
  }

  private async writeSpecies(browser: Browser, id: string) {
    const csvPath = './assets/' + this._CSVName;

    const page = await browser.newPage();
    await page.goto(`${this.usdaGovPlantProfileUrl}${id}`);
    await page.evaluate((selector: string) => {
      try {
        const childrenElements: HTMLCollection | undefined = document.querySelector(selector)?.children;
        if (childrenElements) {
          for (let i = 1; i < childrenElements.length; i++) {
            const childElement: Element = childrenElements.item(i)!;
            if (childElement.tagName === 'H2' && childElement.textContent && childElement.textContent.length > 0) {
              fs.appendFileSync(csvPath, `${id},${'null'},${childElement.textContent!}`);
            }
          }
        }
      } catch (error: any) {
        console.error(error);
      }
      // It will never be the first item so skippity dippity
    }, this._PlantProfileHeaderName);

    await page.close();
  }

  private writeSpeciesRxjs(browser: Browser, id: string): Observable<void> {
    console.log('start rxjs', id);
    return defer(() => (this.writeSpecies(browser, id)));
  }

  destroy(): void {
    this._ngDestroy$.next();
    this._ngDestroy$.complete();
  }
}
