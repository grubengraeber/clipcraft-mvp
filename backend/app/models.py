from pydantic import BaseModel


class CreateJobResponse(BaseModel):
    job_id: str


class JobStatusResponse(BaseModel):
    job_id: str
    status: str
    error: str | None = None
    transcript: str | None = None
    title: str | None = None
    thumbnails: dict[str, str] | None = None
