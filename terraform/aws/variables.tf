/**
 * Variables for TomoriBot infrastructure.
 * Defaults match the current production setup.
 */

variable "aws_region" {
  description = "AWS region for TomoriBot deployment"
  type        = string
  default     = "us-east-1"
}

variable "aws_profile" {
  description = "AWS CLI profile name (null uses default credential chain)"
  type        = string
  default     = null
}

variable "environment" {
  description = "Environment name (production, staging, development)"
  type        = string
  default     = "production"
}

variable "name_prefix" {
  description = "Prefix used for naming AWS resources"
  type        = string
  default     = "tomoribot"
}

variable "avatars_bucket_name" {
  description = "S3 bucket name for persona avatars (null uses default naming)"
  type        = string
  default     = null
}

variable "avatar_bucket_force_destroy" {
  description = "Force destroy the avatar bucket (useful for non-production)"
  type        = bool
  default     = false
}

variable "avatar_bucket_versioning" {
  description = "Enable S3 versioning for avatar bucket"
  type        = bool
  default     = false
}

variable "avatar_bucket_public_read" {
  description = "Allow public read access to avatar objects when CloudFront is disabled"
  type        = bool
  default     = true
  validation {
    condition     = var.enable_avatar_cloudfront || var.avatar_bucket_public_read
    error_message = "Either enable_avatar_cloudfront must be true or avatar_bucket_public_read must be true so avatars are publicly reachable."
  }
}

variable "enable_avatar_cloudfront" {
  description = "Enable CloudFront distribution for avatar bucket"
  type        = bool
  default     = false
}

variable "avatar_cloudfront_price_class" {
  description = "CloudFront price class for avatar distribution"
  type        = string
  default     = "PriceClass_100"
}

variable "vpc_name" {
  description = "Name tag for the VPC"
  type        = string
  default     = "tomoribot-vpc"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "public_subnets" {
  description = "Public subnets for ECS tasks (name, cidr, az)"
  type = list(object({
    name = string
    cidr = string
    az   = string
  }))
  default = [
    {
      name = "tomoribot-subnet-public1-us-east-1a"
      cidr = "10.0.0.0/20"
      az   = "us-east-1a"
    },
    {
      name = "tomoribot-subnet-public2-us-east-1b"
      cidr = "10.0.16.0/20"
      az   = "us-east-1b"
    },
  ]
}

variable "private_subnets" {
  description = "Private subnets for RDS (name, cidr, az)"
  type = list(object({
    name = string
    cidr = string
    az   = string
  }))
  default = [
    {
      name = "tomoribot-subnet-private1-us-east-1a"
      cidr = "10.0.128.0/20"
      az   = "us-east-1a"
    },
    {
      name = "tomoribot-subnet-private2-us-east-1b"
      cidr = "10.0.144.0/20"
      az   = "us-east-1b"
    },
  ]
}

variable "internet_gateway_name" {
  description = "Name tag for the internet gateway"
  type        = string
  default     = "tomoribot-igw"
}

variable "public_route_table_name" {
  description = "Name tag for the public route table"
  type        = string
  default     = "tomoribot-rtb-public"
}

variable "private_route_table_name_prefix" {
  description = "Prefix for private route table name tags"
  type        = string
  default     = "tomoribot-rtb-private"
}

variable "s3_vpc_endpoint_name" {
  description = "Name tag for the S3 VPC endpoint"
  type        = string
  default     = "tomoribot-vpce-s3"
}

variable "app_security_group_name" {
  description = "Security group name for TomoriBot ECS tasks"
  type        = string
  default     = "tomoribot-app"
}

variable "db_security_group_name" {
  description = "Security group name for TomoriBot RDS"
  type        = string
  default     = "tomoribot-db"
}

variable "bastion_security_group_name" {
  description = "Security group name for the bastion host"
  type        = string
  default     = "bastion"
}

variable "bastion_ssh_cidr" {
  description = "CIDR allowed to SSH into the bastion host"
  type        = string
  default     = "119.95.20.218/32"
}

variable "ecs_cluster_name" {
  description = "Name of the ECS cluster where TomoriBot runs"
  type        = string
  default     = "tomoribot-cluster"
}

variable "ecs_service_name" {
  description = "Name of the ECS service for TomoriBot"
  type        = string
  default     = "tomoribot-service"
}

variable "ecs_task_family" {
  description = "ECS task definition family name"
  type        = string
  default     = "tomoribot-task"
}

variable "ecs_desired_count" {
  description = "Desired number of TomoriBot tasks"
  type        = number
  default     = 1
}

variable "ecs_platform_version" {
  description = "Fargate platform version for the ECS service"
  type        = string
  default     = "1.4.0"
}

variable "ecs_capacity_provider" {
  description = "Capacity provider for the ECS service"
  type        = string
  default     = "FARGATE_SPOT"
}

variable "ecs_capacity_provider_base" {
  description = "Base tasks for the capacity provider strategy"
  type        = number
  default     = 0
}

variable "ecs_capacity_provider_weight" {
  description = "Weight for the capacity provider strategy"
  type        = number
  default     = 1
}

variable "container_name" {
  description = "Name of the container in the task definition"
  type        = string
  default     = "tomoribot"
}

variable "container_image" {
  description = "Docker image URI for TomoriBot"
  type        = string
}

variable "ecs_task_cpu" {
  description = "Task CPU units (Fargate task-level)"
  type        = string
  default     = "512"
}

variable "ecs_task_memory" {
  description = "Task memory in MiB (Fargate task-level)"
  type        = string
  default     = "1024"
}

variable "node_env" {
  description = "NODE_ENV for the container"
  type        = string
  default     = "production"
}

variable "run_env" {
  description = "RUN_ENV for the container"
  type        = string
  default     = "production"
}

variable "enable_cloudflare_tunnel_sidecar" {
  description = "Enable Cloudflared sidecar for exposing Matrix appservice callback over HTTPS without an ALB"
  type        = bool
  default     = true
}

variable "cloudflare_tunnel_container_name" {
  description = "Container name for the Cloudflared sidecar"
  type        = string
  default     = "cloudflared"
}

variable "cloudflare_tunnel_image" {
  description = "Docker image for the Cloudflared sidecar"
  type        = string
  default     = "cloudflare/cloudflared:latest"
}

variable "cloudflare_tunnel_token_secret_key" {
  description = "JSON key name inside tomoribot/production secret containing Cloudflare tunnel token"
  type        = string
  default     = "CLOUDFLARE_TUNNEL_TOKEN"
}

# --- SearXNG sidecar (Phase 2) ---

variable "enable_searxng_sidecar" {
  description = "Enable self-hosted SearXNG sidecar in the ECS task (web-search metasearch aggregator)"
  type        = bool
  default     = true
}

variable "searxng_container_name" {
  description = "Container name for the SearXNG sidecar"
  type        = string
  default     = "searxng"
}

variable "searxng_image" {
  description = "SearXNG image pinned by digest; override deliberately with another verified digest"
  type        = string
  # Same digest as servers/searxng/Dockerfile. A moving tag changes the sidecar on any task restart.
  default     = "searxng/searxng@sha256:b8ca38ba06eea544d7555e88321e212ddc0d5c3c7de055419cfb2e5c6bf30812"
}

variable "searxng_secret_key" {
  description = "JSON key name inside tomoribot/production secret containing the SearXNG SECRET value"
  type        = string
  default     = "SEARXNG_SECRET"
}

variable "postgres_user" {
  description = "Postgres username"
  type        = string
  default     = "postgres"
}

variable "postgres_port" {
  description = "Postgres port"
  type        = string
  default     = "5432"
}

variable "postgres_db" {
  description = "Postgres database name"
  type        = string
  default     = "tomoribot"
}

variable "postgres_host_override" {
  description = "Override for POSTGRES_HOST (null uses the RDS endpoint)"
  type        = string
  default     = null
}

variable "log_group_name" {
  description = "Primary CloudWatch log group for TomoriBot"
  type        = string
  default     = "/ecs/tomoribot"
}

variable "extra_log_group_name" {
  description = "Secondary log group (legacy/extra)"
  type        = string
  default     = "/ecs/tomoribot-task"
}

variable "extra_log_retention_days" {
  description = "Retention days for the secondary log group (null leaves it unchanged)"
  type        = number
  default     = null
}

variable "log_retention_days" {
  description = "CloudWatch log retention in days"
  type        = number
  default     = 7
}

variable "health_check_interval" {
  description = "Health check interval in seconds"
  type        = number
  default     = 30
}

variable "health_check_timeout" {
  description = "Health check timeout in seconds"
  type        = number
  default     = 10
}

variable "health_check_retries" {
  description = "Number of consecutive health check failures before marking unhealthy"
  type        = number
  default     = 3
}

variable "health_check_start_period" {
  description = "Grace period in seconds before health checks start"
  type        = number
  default     = 60
}

variable "ecr_repository_name" {
  description = "ECR repository name"
  type        = string
  default     = "tomoribot"
}

variable "ecr_scan_on_push" {
  description = "Enable ECR scan on push"
  type        = bool
  default     = true
}

variable "ecr_tag_mutability" {
  description = "ECR tag mutability (MUTABLE or IMMUTABLE)"
  type        = string
  default     = "MUTABLE"
}

variable "ecs_task_execution_role_name" {
  description = "IAM role name for ECS task execution"
  type        = string
  default     = "tomoribot-execution"
}

variable "ecs_task_execution_role_description" {
  description = "Description for the ECS task execution role"
  type        = string
  default     = "Role for TomoriBot ECS Task Execution"
}

variable "extra_secrets_manager_arns" {
  description = "Extra Secrets Manager ARNs TomoriBot should read"
  type        = list(string)
  default     = []
}

variable "github_actions_role_name" {
  description = "IAM role name for GitHub Actions deployments"
  type        = string
  default     = "gitactions-tomoribot-deploy"
}

variable "github_actions_repo_owner" {
  description = "GitHub org/user that owns the repo"
  type        = string
  default     = "Bredrumb"
}

variable "github_actions_repo_name" {
  description = "GitHub repository name"
  type        = string
  default     = "TomoriBot"
}

variable "github_actions_allowed_refs" {
  description = "Refs allowed to assume the GitHub Actions role"
  type        = list(string)
  default = [
    "refs/heads/release",
    "refs/heads/cicd/aws-deployment",
  ]
}

variable "github_actions_oidc_thumbprints" {
  description = "OIDC thumbprints for token.actions.githubusercontent.com"
  type        = list(string)
  default     = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

variable "secret_access_wildcard" {
  description = "Allow secretsmanager:GetSecretValue on all secrets (matches current policy)"
  type        = bool
  default     = true
}

variable "secrets_manager_secret_name" {
  description = "Secrets Manager secret name for TomoriBot"
  type        = string
  default     = "tomoribot/production"
}

variable "secrets_manager_description" {
  description = "Description for the TomoriBot secret"
  type        = string
  default     = "Combined keys for AWS deployment"
}

variable "secrets_manager_recovery_window_days" {
  description = "Recovery window in days for deleted secrets"
  type        = number
  default     = null
}

variable "rds_instance_identifier" {
  description = "RDS instance identifier"
  type        = string
  default     = "tomoribot-db"
}

variable "rds_db_name" {
  description = "Initial database name"
  type        = string
  default     = "tomoribot"
}

variable "rds_master_username" {
  description = "RDS master username"
  type        = string
  default     = "postgres"
}

variable "rds_master_password" {
  description = "RDS master password (stored in state)"
  type        = string
  sensitive   = true
}

variable "rds_engine_version" {
  description = "Postgres engine version"
  type        = string
  default     = "16.11"
}

variable "rds_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t4g.micro"
}

variable "rds_allocated_storage" {
  description = "Allocated storage in GiB"
  type        = number
  default     = 20
}

variable "rds_storage_type" {
  description = "RDS storage type"
  type        = string
  default     = "gp2"
}

variable "rds_port" {
  description = "RDS port"
  type        = number
  default     = 5432
}

variable "rds_backup_retention_period" {
  description = "Backup retention period in days"
  type        = number
  default     = 1
}

variable "rds_preferred_backup_window" {
  description = "Preferred backup window"
  type        = string
  default     = "04:30-05:00"
}

variable "rds_preferred_maintenance_window" {
  description = "Preferred maintenance window"
  type        = string
  default     = "sat:03:18-sat:03:48"
}

variable "rds_multi_az" {
  description = "Enable Multi-AZ"
  type        = bool
  default     = false
}

variable "rds_publicly_accessible" {
  description = "Expose the RDS instance publicly"
  type        = bool
  default     = false
}

variable "rds_storage_encrypted" {
  description = "Enable storage encryption"
  type        = bool
  default     = true
}

variable "rds_kms_key_id" {
  description = "KMS key ARN for RDS storage encryption"
  type        = string
  default     = "arn:aws:kms:us-east-1:907489583424:key/9832d007-27a9-470c-98de-27aac2629dc2"
}

variable "rds_performance_insights_enabled" {
  description = "Enable Performance Insights"
  type        = bool
  default     = false
}

variable "rds_performance_insights_retention_period" {
  description = "Performance Insights retention in days"
  type        = number
  default     = 0
}

variable "rds_performance_insights_kms_key_id" {
  description = "KMS key ARN for Performance Insights"
  type        = string
  default     = null
}

variable "rds_deletion_protection" {
  description = "Enable deletion protection"
  type        = bool
  default     = false
}

variable "rds_skip_final_snapshot" {
  description = "Skip final snapshot on deletion"
  type        = bool
  default     = true
}

variable "rds_auto_minor_version_upgrade" {
  description = "Enable automatic minor version upgrades"
  type        = bool
  default     = true
}

variable "rds_copy_tags_to_snapshot" {
  description = "Copy instance tags to RDS snapshots"
  type        = bool
  default     = false
}

variable "rds_apply_immediately" {
  description = "Apply modifications immediately (use carefully in production)"
  type        = bool
  default     = false
}

variable "rds_subnet_group_name" {
  description = "RDS subnet group name"
  type        = string
  default     = "tomoribot-private-subnets"
}

variable "rds_subnet_group_description" {
  description = "RDS subnet group description"
  type        = string
  default     = "Private subnets for TomoriBot"
}

variable "rds_parameter_group_name" {
  description = "RDS parameter group name"
  type        = string
  default     = "tomoribot-secure-pg"
}

variable "rds_parameter_group_family" {
  description = "RDS parameter group family"
  type        = string
  default     = "postgres16"
}

variable "rds_parameter_cron_database_name" {
  description = "cron.database_name for pg_cron metadata"
  type        = string
  default     = "tomoribot"
}

variable "rds_parameter_allowed_extensions" {
  description = "rds.allowed_extensions value"
  type        = string
  default     = "pg_cron,pgcrypto,vector"
}

variable "rds_parameter_shared_preload_libraries" {
  description = "shared_preload_libraries value"
  type        = string
  default     = "pg_cron,pg_stat_statements,pg_tle"
}
