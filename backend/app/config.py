from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Auto Thumbnail MVP"
    backend_api_key: str = "change-me"
    storage_dir: str = "storage/jobs"
    whisper_model: str = "base"
    max_video_seconds: int = 30

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()
