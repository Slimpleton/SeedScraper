import { finalize } from "rxjs";
import { PlantsWebScraperService } from "./plants-web-scraper.service";
import { GovPlantsDataService } from "./PLANTS_data.service";

async function run(){
    const plantsService: GovPlantsDataService = new GovPlantsDataService();
    const scraper : PlantsWebScraperService = new PlantsWebScraperService(plantsService);

    scraper.write().pipe(finalize(() => scraper.destroy())).subscribe();
}

run();