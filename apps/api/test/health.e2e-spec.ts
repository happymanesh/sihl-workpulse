import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";

describe("Health (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /health returns 200 without auth (public route)", () => {
    return request(app.getHttpServer())
      .get("/health")
      .expect(200)
      .expect((res: request.Response) => {
        expect(res.body).toHaveProperty("status");
        expect(res.body).toHaveProperty("checks.database");
        expect(res.body).toHaveProperty("checks.redis");
        expect(res.body).toHaveProperty("checks.synapse");
      });
  });

  it("GET /employees rejects requests with no Synapse session", () => {
    return request(app.getHttpServer()).get("/employees").expect(401);
  });
});
