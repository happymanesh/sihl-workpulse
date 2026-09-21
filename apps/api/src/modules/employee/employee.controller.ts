import { Controller, Get, Param, Query, NotFoundException } from "@nestjs/common";
import { Roles } from "../auth/roles.decorator";
import { EmployeeService } from "./employee.service";
import type { EmployeeSummary } from "@workpulse/shared-types";

@Controller("employees")
export class EmployeeController {
  constructor(private readonly employeeService: EmployeeService) {}

  @Roles("SYSTEM_ADMIN", "MANAGER", "DEPARTMENT_HEAD", "EXECUTIVE", "EXECUTIVE_RESTRICTED")
  @Get()
  async list(
    @Query("departmentId") departmentId?: string,
    @Query("activeOnly") activeOnly?: string,
  ): Promise<EmployeeSummary[]> {
    return this.employeeService.list({ departmentId, activeOnly: activeOnly !== "false" });
  }

  @Roles("SYSTEM_ADMIN", "MANAGER", "DEPARTMENT_HEAD", "EXECUTIVE", "EXECUTIVE_RESTRICTED")
  @Get(":id")
  async findById(@Param("id") id: string): Promise<EmployeeSummary> {
    const employee = await this.employeeService.findById(id);
    if (!employee) throw new NotFoundException(`Employee ${id} not found`);
    return employee;
  }
}
